import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

function resolveExtensionPath(): string {
  const currentDir = new URL('.', import.meta.url);
  const projectRoot = new URL('../../', currentDir);
  const extDir = new URL('.output/chrome-mv3/', projectRoot);
  return extDir.pathname;
}

export async function launchExtension(): Promise<{ context: BrowserContext }> {
  const pathToExtension = resolveExtensionPath();

  // Create unique userDataDir per worker for extension isolation
  const userDataDir = await mkdtemp(join(tmpdir(), 'intender-test-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
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

  // Attach CDP to service worker for logging (MV3-safe with auto-attach)
  try {
    // Ensure a page exists to bind a CDP session
    if (context.pages().length === 0) {
      await context.newPage();
    }
    const page = context.pages()[0];
    const cdp = await context.newCDPSession(page);

    // Track SW sessions we attach to
    const swSessionIds = new Set<string>();

    // Get extension ID (used to filter the correct SW)
    const sw =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(sw.url()).host;

    // Auto-attach to SW targets and enable Runtime/Log for them
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: 'service_worker', exclude: false }],
    } as any);

    cdp.on('Target.attachedToTarget', async (evt: any) => {
      const info = evt.targetInfo;
      if (
        info?.type === 'service_worker' &&
        typeof info.url === 'string' &&
        info.url.startsWith(`chrome-extension://${extensionId}/`)
      ) {
        swSessionIds.add(evt.sessionId);
        // Enable Runtime + Log domains inside the SW session
        cdp
          .send('Target.sendMessageToTarget', {
            sessionId: evt.sessionId,
            message: JSON.stringify({ id: 1, method: 'Runtime.enable' }),
          } as any)
          .catch(() => {});
        cdp
          .send('Target.sendMessageToTarget', {
            sessionId: evt.sessionId,
            message: JSON.stringify({ id: 2, method: 'Log.enable' }),
          } as any)
          .catch(() => {});
        console.log('[SW-CDP] Attached to service worker, console/log enabled');
      }
    });

    // Receive child target events and forward SW console
    cdp.on('Target.receivedMessageFromTarget', (evt: any) => {
      if (!swSessionIds.has(evt.sessionId)) return;
      try {
        const msg = JSON.parse(evt.message);
        if (msg.method === 'Runtime.consoleAPICalled') {
          const level = (msg.params?.type || 'log').toUpperCase();
          const args = (msg.params?.args || []).map(
            (a: any) => a.value ?? a.description ?? '[object]'
          );
          console.log(`[SW-${level}]`, ...args);
        } else if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params?.exceptionDetails;
          console.log(
            '[SW-EXCEPTION]',
            d?.text || '',
            d?.exception?.description || ''
          );
        } else if (msg.method === 'Log.entryAdded') {
          const e = msg.params?.entry;
          if (e) console.log(`[SW-LOG ${e.level}]`, e.source, e.text);
        }
      } catch {
        // ignore parse errors
      }
    });

    // If a SW target already exists, attach to it now (auto-attach handles restarts)
    const { targetInfos } = await cdp.send('Target.getTargets');
    const swTarget = targetInfos.find(
      (t: any) =>
        t.type === 'service_worker' &&
        typeof t.url === 'string' &&
        t.url.startsWith(`chrome-extension://${extensionId}/`)
    );
    if (swTarget) {
      await cdp.send('Target.attachToTarget', {
        targetId: swTarget.targetId,
        flatten: true,
      } as any);
    }
  } catch (error) {
    console.log('[SW] Failed to attach CDP to service worker:', error);
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
