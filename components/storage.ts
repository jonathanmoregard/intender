import browser from 'webextension-polyfill';
import { RawIntention } from './intention';

declare const __IS_DEV__: boolean;

const backend = __IS_DEV__ ? browser.storage.local : browser.storage.sync;

export type InactivityMode = 'off' | 'all-except-audio' | 'all';

export interface InactivitySettings {
  mode: InactivityMode;
  timeoutMinutes: number;
}

export const storage = {
  async get(): Promise<{
    intentions: RawIntention[];
    fuzzyMatching?: boolean;
    inactivityMode?: InactivityMode;
    inactivityTimeoutMinutes?: number;
  }> {
    const result = await backend.get({
      intentions: [],
      fuzzyMatching: true,
      inactivityMode: 'off',
      inactivityTimeoutMinutes: 30,
    });
    return result as {
      intentions: RawIntention[];
      fuzzyMatching?: boolean;
      inactivityMode?: InactivityMode;
      inactivityTimeoutMinutes?: number;
    };
  },
  async set(
    data:
      | { intentions: RawIntention[] }
      | { fuzzyMatching: boolean }
      | { inactivityMode: InactivityMode }
      | { inactivityTimeoutMinutes: number }
  ) {
    await backend.set(data);
  },
};
