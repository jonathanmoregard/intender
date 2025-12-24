import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readdir, stat, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import winston from 'winston';

// Keep a module-scoped handle to the current test's tee logger so we can append
// PASS/FAIL at the end of each test into the same file.
let currentTeeLogger: winston.Logger | null = null;
let currentTeeTestName: string | undefined;

function resolveExtensionPath(): string {
  const currentDir = new URL('.', import.meta.url);
  const projectRoot = new URL('../../', currentDir);
  const extDir = new URL('.output/chrome-mv3/', projectRoot);
  return extDir.pathname;
}

async function cleanupOldLogs(logDir: string): Promise<void> {
  try {
    const files = await readdir(logDir);
    const now = Date.now();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

    for (const file of files) {
      const filePath = join(logDir, file);
      const stats = await stat(filePath);
      if (now - stats.mtime.getTime() > twoDaysMs) {
        await unlink(filePath);
      }
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

async function createSwTeeLogger(
  testName?: string
): Promise<winston.Logger | null> {
  // Skip SW log tee unless explicitly enabled
  if (!process.env.TEST_SW_LOG) {
    return null;
  }

  // Use run-specific directory if available, fallback to legacy location
  const runDir = process.env.INTENDER_TEST_RUN_DIR;
  const logDir = runDir
    ? join(runDir, 'logs')
    : join(process.cwd(), '.test-results/logs');
  await mkdir(logDir, { recursive: true });

  // Clean up old logs (> 2 days) only for legacy location
  if (!runDir) {
    await cleanupOldLogs(logDir);
  }

  // Use precomputed basename if available, otherwise fallback to timestamped name
  const precomputedBasename = process.env.INTENDER_SW_LOG_BASENAME;
  const filename = precomputedBasename
    ? `sw-background.${precomputedBasename}`
    : (() => {
        const timestamp = Date.now();
        const workerIndex = process.env.TEST_WORKER_INDEX || '0';
        const sanitizedTestName = testName
          ? testName.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50)
          : 'unknown';
        return `sw-background.${sanitizedTestName}.${workerIndex}.${timestamp}.log`;
      })();

  const fileTransport = new winston.transports.File({
    filename: join(logDir, filename),
    format: winston.format.printf(({ message }) => String(message)),
    level: 'debug',
  });

  // Only use console transport in non-parallel runs to reduce noise
  const transports: winston.transport[] = [fileTransport];
  if (process.env.TEST_WORKER_INDEX === undefined) {
    const consoleTransport = new winston.transports.Console({
      format: winston.format.printf(
        ({ level, message }) => `[SW-${level.toUpperCase()}] ${String(message)}`
      ),
      level: 'debug',
    });
    transports.push(consoleTransport);
  }

  return winston.createLogger({
    level: 'debug',
    transports,
  });
}

// Helper to get current test name from test context
function getCurrentTestName(): string | undefined {
  // Try to get test name from various sources
  if (process.env.TEST_NAME) {
    return process.env.TEST_NAME;
  }

  // Fallback to worker index and timestamp
  const workerIndex = process.env.TEST_WORKER_INDEX || '0';
  return `test_${workerIndex}_${Date.now()}`;
}

async function enableDebugLoggingForTests(
  context: BrowserContext,
  tee?: winston.Logger | null
): Promise<void> {
  if (!process.env.TEST_SW_LOG) return;

  try {
    const target =
      context.serviceWorkers()[0] ||
      (await context
        .waitForEvent('serviceworker', { timeout: 5000 })
        .catch(() => null)) ||
      context.backgroundPages()[0] ||
      (await context
        .waitForEvent('backgroundpage', { timeout: 5000 })
        .catch(() => null));

    if (!target) {
      tee?.warn('No extension context available for debug logging');
      return;
    }

    await target.evaluate(() => {
      const api =
        (globalThis as any).chrome?.storage ??
        (globalThis as any).browser?.storage;
      (api?.sync ?? api?.local)?.set({ debugLogging: true });
    });
  } catch (error) {
    tee?.warn(`Failed to enable debug logging: ${String(error)}`);
  }
}

async function cleanupTestLogs(context: BrowserContext): Promise<void> {
  try {
    const sw = context.serviceWorkers()[0];
    if (sw) {
      // Disable debug logging via storage flag
      await sw.evaluate(async () => {
        const api =
          (globalThis as any).chrome?.storage ??
          (globalThis as any).browser?.storage;
        await (api.sync ?? api.local).set({ debugLogging: false });
      });
    }
  } catch (error) {
    // Ignore cleanup errors (SW might already be terminated)
  }
}

export async function launchExtension(
  testName?: string
): Promise<{ context: BrowserContext }> {
  const pathToExtension = resolveExtensionPath();
  const userDataDir = await mkdtemp(join(tmpdir(), 'intender-test-'));

  const actualTestName = testName || getCurrentTestName();
  const tee = await createSwTeeLogger(actualTestName);
  tee?.info('Winston tee logger initialized');
  currentTeeLogger = tee ?? null;
  currentTeeTestName = actualTestName;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
      // Relax security interstitials for tests to avoid flakiness with redirects/HSTS/SSL
      '--test-type',
      '--ignore-certificate-errors',
      '--allow-insecure-localhost',
      '--allow-running-insecure-content',
      '--disable-features=SSLKeyLogFile,IsolateOrigins,site-per-process,BlockInsecurePrivateNetworkRequests',
      '--disable-web-security',
      '--no-default-browser-check',
      '--no-first-run',
      '--disable-popup-blocking',
    ],
  });

  // Firefox-compatible approach: Poll storage.local for logs written by background script
  const setupStorageLogPolling = async () => {
    try {
      // Wait for service worker to be available
      const sw =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent('serviceworker', { timeout: 10000 }));

      tee?.info(`Found service worker: ${sw.url()}`);

      // Enable debug logging via storage flag (writes to both console and storage)
      await sw.evaluate(async () => {
        const api =
          (globalThis as any).chrome?.storage ??
          (globalThis as any).browser?.storage;
        await (api.sync ?? api.local).set({ debugLogging: true });
      });

      tee?.info('Test logging enabled in service worker');

      // Track the last processed log index to avoid duplicates
      let lastProcessedIndex = 0;

      // Poll storage.local for logs every 50ms
      const pollLogs = async () => {
        try {
          // Read logs from storage.local via service worker
          const logs = await sw.evaluate(async () => {
            const api =
              (globalThis as any).chrome?.storage ??
              (globalThis as any).browser?.storage;
            const result = await api.local.get('__testLogs');
            return result.__testLogs || [];
          });

          // Process only new logs since last poll
          const newLogs = logs.slice(lastProcessedIndex);
          lastProcessedIndex = logs.length;

          newLogs.forEach((log: any) => {
            const { level, message } = log;
            switch (level) {
              case 'error':
                tee?.error(message);
                break;
              case 'warn':
                tee?.warn(message);
                break;
              default:
                tee?.info(message);
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
      tee?.error(`Failed to setup storage log polling: ${error}`);
    }
  };

  // Setup log polling only when logger is active
  if (currentTeeLogger) {
    setupStorageLogPolling();
  }

  if (process.env.TEST_SW_LOG) {
    await enableDebugLoggingForTests(context, tee);
  }

  return { context };
}

// Get the extension ID by checking loaded extensions

/**
 * Stops the service worker associated with the extension using Chrome DevTools Protocol.
 * This is more reliable than the previous globalThis.close() approach.
 *
 * @param {BrowserContext} context Browser context
 */
export async function stopServiceWorker(
  context: BrowserContext
): Promise<void> {
  try {
    const extensionId = await getExtensionId(context);
    const host = `chrome-extension://${extensionId}`;

    // Get service workers from context
    const serviceWorkers = context.serviceWorkers();
    const targetWorker = serviceWorkers.find(sw => sw.url().startsWith(host));

    if (targetWorker) {
      // Service worker will be terminated when we close the context or use CDP
      console.log(
        `[Test] Service worker found for extension ${extensionId}, will be terminated`
      );
      // Force termination by sending a message to close
      try {
        await targetWorker.evaluate(() => {
          // @ts-ignore
          if (typeof globalThis.close === 'function') {
            // @ts-ignore
            globalThis.close();
          }
        });
      } catch (e) {
        // Worker might already be terminated
      }
    } else {
      console.log(
        `[Test] No service worker found for extension ${extensionId}`
      );
    }
  } catch (error) {
    console.log(`[Test] Failed to stop service worker: ${error}`);
    // Don't throw - this is best effort
  }
}

// Append a single-line test result marker into the same SW log file
export function logSwTestResult(
  status: 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED',
  meta?: {
    title?: string;
    repeatEachIndex?: number;
    retry?: number;
  }
): void {
  if (!currentTeeLogger) return;
  const parts: string[] = [
    `[RESULT] ${status}`,
    currentTeeTestName ? `testName=${currentTeeTestName}` : undefined,
    meta?.title ? `title=${meta.title}` : undefined,
    meta?.repeatEachIndex !== undefined
      ? `repeat=${meta.repeatEachIndex}`
      : undefined,
    meta?.retry !== undefined ? `retry=${meta.retry}` : undefined,
  ].filter(Boolean) as string[];
  currentTeeLogger.info(parts.join(' '));
}

// Clean up test logging at the end of a test
export async function cleanupTestLogging(
  context: BrowserContext
): Promise<void> {
  await cleanupTestLogs(context);
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const sw =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  return new URL(sw.url()).host;
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
