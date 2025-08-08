import { chromium, type BrowserContext, type Page } from '@playwright/test';

function resolveExtensionPath(): string {
  const currentDir = new URL('.', import.meta.url);
  const projectRoot = new URL('../../', currentDir);
  const extDir = new URL('.output/chrome-mv3/', projectRoot);
  return extDir.pathname;
}

export async function launchExtension(): Promise<{ context: BrowserContext }> {
  const pathToExtension = resolveExtensionPath();
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });

  await new Promise(resolve => setTimeout(resolve, 2000));
  if (context.serviceWorkers().length === 0) {
    try {
      await context.waitForEvent('serviceworker', { timeout: 10000 });
    } catch {
      // continue
    }
  }

  return { context };
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const sw =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  return new URL(sw.url()).host;
}

export async function openSettingsPage(
  context: BrowserContext,
  params?: { e2eInactivityTimeoutMs?: number }
): Promise<{ page: Page; extensionId: string }> {
  const extensionId = await getExtensionId(context);
  const url = new URL(`chrome-extension://${extensionId}/settings.html`);
  if (params?.e2eInactivityTimeoutMs) {
    url.searchParams.set(
      'e2eInactivityTimeoutMs',
      String(params.e2eInactivityTimeoutMs)
    );
  }
  const page = await context.newPage();
  await page.goto(url.toString());
  return { page, extensionId };
}

export async function waitForSyncStorageChange(
  page: Page,
  keys: string[]
): Promise<void> {
  await page.evaluate((watchedKeys: string[]) => {
    window.__waitForStorageChange = new Promise<void>(resolve => {
      const handler = (changes: Record<string, unknown>, area: string) => {
        if (
          area === 'sync' &&
          watchedKeys.some(k =>
            Object.prototype.hasOwnProperty.call(changes, k)
          )
        ) {
          window.chrome.storage.onChanged.removeListener(
            handler as Parameters<
              typeof window.chrome.storage.onChanged.addListener
            >[0]
          );
          resolve();
        }
      };
      window.chrome.storage.onChanged.addListener(
        handler as Parameters<
          typeof window.chrome.storage.onChanged.addListener
        >[0]
      );
    });
  }, keys);
  await page.evaluate(() => window.__waitForStorageChange);
}
