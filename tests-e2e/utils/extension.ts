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

  // Simple working approach: Direct service worker console interception
  const setupConsoleInterception = async () => {
    try {
      // Wait for service worker
      const sw =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent('serviceworker', { timeout: 10000 }));

      tee?.info(`Found service worker: ${sw.url()}`);

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

      tee?.info('Console interception installed');

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
      tee?.error(`Failed to setup console interception: ${error}`);
    }
  };

  // Setup interception only when logger is active
  if (currentTeeLogger) {
    setupConsoleInterception();
  }

  return { context };
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

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const sw =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  return new URL(sw.url()).host;
}

export async function openSettingsPage(
  context: BrowserContext,
  params?: { e2eInactivityTimeoutMs?: number }
): Promise<{ settingsPage: Page; extensionId: string }> {
  const extensionId = await getExtensionId(context);
  const url = new URL(`chrome-extension://${extensionId}/settings.html`);
  if (params?.e2eInactivityTimeoutMs) {
    url.searchParams.set(
      'e2eInactivityTimeoutMs',
      String(params.e2eInactivityTimeoutMs)
    );
  }
  const settingsPage = await context.newPage();
  await settingsPage.goto(url.toString());
  return { settingsPage, extensionId };
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
