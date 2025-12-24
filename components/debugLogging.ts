import browser from 'webextension-polyfill';

// Single debug logging state - when enabled, writes to both console and storage
let debugLoggingEnabled = false;

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

  // If new logs were added during the flush, schedule another flush
  if (logBuffer.length > 0) {
    scheduleFlush();
  }
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
 * Debug logging function that logs to both console and storage when debug logging is enabled
 */
export function debugLog(...args: unknown[]): void {
  if (!debugLoggingEnabled) return;

  // Always log to console when debug logging is enabled
  console.log(...args);

  // Also store for tests when debug logging is enabled
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

/**
 * Set debug logging state (enables/disables both console and storage logging)
 */
export function setDebugLogging(enabled: boolean): void {
  debugLoggingEnabled = enabled;
  if (enabled) {
    console.log('[Intender] Debug logging enabled');
  }
}
