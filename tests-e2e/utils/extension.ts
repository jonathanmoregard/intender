import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import winston from 'winston';

function resolveExtensionPath(): string {
  const currentDir = new URL('.', import.meta.url);
  const projectRoot = new URL('../../', currentDir);
  const extDir = new URL('.output/chrome-mv3/', projectRoot);
  return extDir.pathname;
}

async function createSwTeeLogger(): Promise<winston.Logger> {
  const logDir = join(process.cwd(), '.test-data');
  await mkdir(logDir, { recursive: true });

  const fileTransport = new winston.transports.File({
    filename: join(logDir, 'sw-background.log'),
    options: { flags: 'w' },
    format: winston.format.printf(({ message }) => String(message)),
    level: 'debug',
  });

  const consoleTransport = new winston.transports.Console({
    format: winston.format.printf(
      ({ level, message }) => `[SW-${level.toUpperCase()}] ${String(message)}`
    ),
    level: 'debug',
  });

  return winston.createLogger({
    level: 'debug',
    transports: [fileTransport, consoleTransport],
  });
}

export async function launchExtension(): Promise<{ context: BrowserContext }> {
  const pathToExtension = resolveExtensionPath();
  const userDataDir = await mkdtemp(join(tmpdir(), 'intender-test-'));

  const tee = await createSwTeeLogger();
  tee.info('Winston tee logger initialized');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });

  // Simple working approach: Direct service worker console interception
  const setupConsoleInterception = async () => {
    try {
      // Wait for service worker
      const sw =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent('serviceworker', { timeout: 10000 }));

      tee.info(`Found service worker: ${sw.url()}`);

      // Inject console interceptor
      await sw.evaluate(() => {
        const original = {
          log: console.log,
          info: console.info,
          warn: console.warn,
          error: console.error,
        };

        // Create global log storage
        (globalThis as any).__interceptedLogs = [];

        const intercept =
          (level: string) =>
          (...args: any[]) => {
            // Call original
            (original as any)[level](...args);

            // Store for retrieval
            const message = args
              .map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
              )
              .join(' ');

            (globalThis as any).__interceptedLogs.push({
              level,
              message,
              timestamp: Date.now(),
            });
          };

        console.log = intercept('info');
        console.info = intercept('info');
        console.warn = intercept('warn');
        console.error = intercept('error');

        console.log('Console interception enabled');
      });

      tee.info('Console interception installed');

      // Poll for logs every 50ms
      const pollLogs = async () => {
        try {
          const logs = await sw.evaluate(() => {
            const logs = (globalThis as any).__interceptedLogs || [];
            (globalThis as any).__interceptedLogs = []; // Clear
            return logs;
          });

          logs.forEach((log: any) => {
            const { level, message } = log;
            switch (level) {
              case 'error':
                tee.error(message);
                break;
              case 'warn':
                tee.warn(message);
                break;
              default:
                tee.info(message);
                break;
            }
          });
        } catch (e) {
          // SW might be gone, stop polling
          return;
        }

        // Continue polling
        setTimeout(pollLogs, 50);
      };

      pollLogs();
    } catch (error) {
      tee.error(`Failed to setup console interception: ${error}`);
    }
  };

  // Setup interception
  setupConsoleInterception();

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
