import browser from 'webextension-polyfill';
import { RawIntention } from './intention';
import type { TimeoutMs } from './time';

declare const __IS_DEV__: boolean;

const backend = __IS_DEV__ ? browser.storage.local : browser.storage.sync;

export type InactivityMode = 'off' | 'all-except-audio' | 'all';
export type BreathAnimationIntensity = 'off' | 'minimal' | 'medium' | 'heavy';

export interface InactivitySettings {
  mode: InactivityMode;
  timeoutMs: TimeoutMs;
}

export interface BreathAnimationSettings {
  intensity: BreathAnimationIntensity;
}

export const storage = {
  async get(): Promise<{
    intentions: RawIntention[];
    fuzzyMatching?: boolean;
    inactivityMode?: InactivityMode;
    inactivityTimeoutMs?: TimeoutMs;
    showAdvancedSettings?: boolean;
    canCopyIntentionText?: boolean;
    breathAnimationIntensity?: BreathAnimationIntensity;
  }> {
    const result = await backend.get({
      intentions: [],
      fuzzyMatching: true,
      inactivityMode: 'off',
      inactivityTimeoutMs: (30 * 60 * 1000) as TimeoutMs,
      showAdvancedSettings: false,
      canCopyIntentionText: false,
      breathAnimationIntensity: 'minimal',
    });
    return result as {
      intentions: RawIntention[];
      fuzzyMatching?: boolean;
      inactivityMode?: InactivityMode;
      inactivityTimeoutMs?: TimeoutMs;
      showAdvancedSettings?: boolean;
      canCopyIntentionText?: boolean;
      breathAnimationIntensity?: BreathAnimationIntensity;
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
  ) {
    await backend.set(data);
  },
};
