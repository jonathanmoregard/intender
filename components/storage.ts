import browser from 'webextension-polyfill';
import { RawIntention } from './intention';
import type { TimeoutMs } from './time';

declare const __IS_DEV__: boolean;

// Browser detection: Firefox has getBrowserInfo, Chrome doesn't
const isFirefox = (() => {
  try {
    return (
      typeof (browser.runtime as { getBrowserInfo?: () => unknown })
        .getBrowserInfo === 'function'
    );
  } catch {
    return false;
  }
})();

// Persistent storage backend selection:
// - Firefox: always use local (sync has stricter limits and can fail)
// - Chrome: use sync in production, local in dev
const persistentBackend = isFirefox
  ? browser.storage.local
  : __IS_DEV__
    ? browser.storage.local
    : browser.storage.sync;

// Session storage abstraction:
// - Chrome: use chrome.storage.session (native)
// - Firefox: use storage.local with __session__ prefix (Firefox doesn't have session storage)
const SESSION_PREFIX = '__session__';

const getSessionKey = (key: string): string => `${SESSION_PREFIX}${key}`;

const sessionBackend = (() => {
  // Check if chrome.storage.session exists (Chrome-only)
  const chromeSession = (
    globalThis as { chrome?: { storage?: { session?: unknown } } }
  ).chrome?.storage?.session;
  if (chromeSession !== undefined && chromeSession !== null) {
    return chromeSession as typeof browser.storage.local;
  }
  // Firefox fallback: use local storage with prefix
  return {
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      let localKeys: string[] | null = null;
      if (keys === null || keys === undefined) {
        // Get all keys and filter by prefix
        localKeys = null;
      } else if (typeof keys === 'string') {
        localKeys = [getSessionKey(keys)];
      } else if (Array.isArray(keys)) {
        localKeys = keys.map(getSessionKey);
      } else {
        localKeys = Object.keys(keys).map(getSessionKey);
      }
      const result = await browser.storage.local.get(localKeys);
      // Remove prefix from keys in result
      const unprefixed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(result)) {
        if (key.startsWith(SESSION_PREFIX)) {
          unprefixed[key.slice(SESSION_PREFIX.length)] = value;
        }
      }
      return unprefixed;
    },
    async set(items: Record<string, unknown>) {
      const prefixed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(items)) {
        prefixed[getSessionKey(key)] = value;
      }
      await browser.storage.local.set(prefixed);
    },
    async remove(keys: string | string[]) {
      const localKeys = Array.isArray(keys)
        ? keys.map(getSessionKey)
        : [getSessionKey(keys)];
      await browser.storage.local.remove(localKeys);
    },
  };
})();

export type InactivityMode = 'off' | 'all-except-audio' | 'all';
export type BreathAnimationIntensity = 'off' | 'minimal' | 'medium' | 'heavy';

export const storage = {
  async get(): Promise<{
    intentions: RawIntention[];
    fuzzyMatching?: boolean;
    inactivityMode?: InactivityMode;
    inactivityTimeoutMs?: TimeoutMs;
    showAdvancedSettings?: boolean;
    canCopyIntentionText?: boolean;
    breathAnimationIntensity?: BreathAnimationIntensity;
    directToSettings?: boolean;
    debugLogging?: boolean;
  }> {
    const defaults = {
      intentions: [],
      fuzzyMatching: true,
      inactivityMode: 'off' as InactivityMode,
      inactivityTimeoutMs: (30 * 60 * 1000) as TimeoutMs,
      showAdvancedSettings: false,
      canCopyIntentionText: false,
      breathAnimationIntensity: 'minimal' as BreathAnimationIntensity,
      directToSettings: false,
      debugLogging: false,
    };

    const result = await persistentBackend.get(defaults);
    return {
      ...defaults,
      ...result,
    };
  },
  async set(
    data:
      | { intentions: RawIntention[] }
      | { fuzzyMatching: boolean }
      | { inactivityMode: InactivityMode }
      | { inactivityTimeoutMs: TimeoutMs }
      | { showAdvancedSettings: boolean }
      | { canCopyIntentionText: boolean }
      | { breathAnimationIntensity: BreathAnimationIntensity }
      | { directToSettings: boolean }
      | { debugLogging: boolean }
  ) {
    await persistentBackend.set(data);
  },
  // Session storage API (for temporary session state)
  session: {
    async get(
      keys?: string | string[] | Record<string, unknown> | null
    ): Promise<Record<string, unknown>> {
      return await sessionBackend.get(keys);
    },
    async set(items: Record<string, unknown>): Promise<void> {
      await sessionBackend.set(items);
    },
    async remove(keys: string | string[]): Promise<void> {
      await sessionBackend.remove(keys);
    },
  },
  // Direct local storage access (for debug logs, etc.)
  local: {
    async get(
      keys?: string | string[] | Record<string, unknown> | null
    ): Promise<Record<string, unknown>> {
      return await browser.storage.local.get(keys);
    },
    async set(items: Record<string, unknown>): Promise<void> {
      await browser.storage.local.set(items);
    },
  },
};
