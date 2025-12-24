import browser from 'webextension-polyfill';

// Logging state
let storageLoggingEnabled = false;
let consoleLoggingEnabled = false;

// Buffer to batch writes to storage
const logBuffer: Array<{
  level: string;
  message: string;
  timestamp: number;
}> = [];
let flushScheduled = false;
const MAX_BUFFER_SIZE = 50;
const FLUSH_INTERVAL_MS = 100;

const flushLogs = async () => {
  if (logBuffer.length === 0) {
    flushScheduled = false;
    return;
  }

  const logsToWrite = logBuffer.splice(0, logBuffer.length);

  try {
    // Read existing logs
    const result = await browser.storage.local.get('__testLogs');
    const existing = (result.__testLogs as typeof logsToWrite) || [];

    // Append new logs (keep last 1000 to avoid storage limits)
    const combined = [...existing, ...logsToWrite].slice(-1000);

    await browser.storage.local.set({ __testLogs: combined });
  } catch (error) {
    console.error('[Intender] Failed to write logs to storage:', error);
  }

  flushScheduled = false;
};

const scheduleFlush = () => {
  if (flushScheduled) return;
  flushScheduled = true;

  // Flush immediately if buffer is full, otherwise batch
  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    flushLogs();
  } else {
    setTimeout(flushLogs, FLUSH_INTERVAL_MS);
  }
};

/**
 * Debug logging function that logs to console (when console logging enabled) and storage.local (when storage logging enabled)
 */
export function debugLog(...args: unknown[]): void {
  // Always log to console if console logging is enabled
  if (consoleLoggingEnabled) {
    console.log(...args);
  }

  // Store for tests if storage logging is enabled
  if (storageLoggingEnabled) {
    const message = args
      .map(arg => {
        try {
          return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');

    logBuffer.push({
      level: 'info',
      message,
      timestamp: Date.now(),
    });

    scheduleFlush();
  }
}

/**
 * Set console logging state (controls console output)
 */
export function setConsoleLogging(enabled: boolean): void {
  consoleLoggingEnabled = enabled;
}

/**
 * Enable storage logging (for E2E tests)
 */
export function enableStorageLogging(): void {
  storageLoggingEnabled = true;
  console.log('[Intender] Storage logging enabled');
}

/**
 * Disable storage logging
 */
export function disableStorageLogging(): void {
  storageLoggingEnabled = false;
  flushLogs(); // Flush any remaining logs
}

/**
 * Flush storage logs immediately
 */
export async function flushStorageLogs(): Promise<void> {
  await flushLogs();
}

/**
 * Clear all storage logs
 */
export async function clearStorageLogs(): Promise<void> {
  logBuffer.length = 0;
  await browser.storage.local.remove('__testLogs');
}
