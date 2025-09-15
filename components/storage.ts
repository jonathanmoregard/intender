import browser from 'webextension-polyfill';
import { RawIntention } from './intention';
import type { TimeoutMs } from './time';

declare const __IS_DEV__: boolean;

const backend = __IS_DEV__ ? browser.storage.local : browser.storage.sync;

export type InactivityMode = 'off' | 'all-except-audio' | 'all';

export interface InactivitySettings {
  mode: InactivityMode;
  timeoutMs: TimeoutMs;
}

export const storage = {
  async get(): Promise<{
    intentions: RawIntention[];
    fuzzyMatching?: boolean;
    inactivityMode?: InactivityMode;
    inactivityTimeoutMs?: TimeoutMs;
    showAdvancedSettings?: boolean;
  }> {
    const result = await backend.get({
      intentions: [],
      fuzzyMatching: true,
      inactivityMode: 'off',
      inactivityTimeoutMs: (30 * 60 * 1000) as TimeoutMs,
      showAdvancedSettings: false,
    });
    return result as {
      intentions: RawIntention[];
      fuzzyMatching?: boolean;
      inactivityMode?: InactivityMode;
      inactivityTimeoutMs?: TimeoutMs;
      showAdvancedSettings?: boolean;
    };
  },
  async set(
    data:
      | { intentions: RawIntention[] }
      | { fuzzyMatching: boolean }
      | { inactivityMode: InactivityMode }
      | { inactivityTimeoutMs: TimeoutMs }
      | { showAdvancedSettings: boolean }
  ) {
    await backend.set(data);
  },
};
