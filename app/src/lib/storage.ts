import { createMMKV, MMKV } from 'react-native-mmkv';
import { RawIntention } from './intention';
import type { TimeoutMs } from './time';

const storage = createMMKV();

export type InactivityMode = 'off' | 'all-except-audio' | 'all';
export type BreathAnimationIntensity = 'off' | 'minimal' | 'medium' | 'heavy';

export const appStorage = {
  get(): {
    intentions: RawIntention[];
    fuzzyMatching: boolean;
    inactivityMode: InactivityMode;
    inactivityTimeoutMs: TimeoutMs;
    showAdvancedSettings: boolean;
    canCopyIntentionText: boolean;
    breathAnimationIntensity: BreathAnimationIntensity;
    directToSettings: boolean;
    debugLogging: boolean;
  } {
    const intentionsJson = storage.getString('intentions');
    const fuzzyMatching = storage.getBoolean('fuzzyMatching') ?? true;
    const inactivityMode =
      (storage.getString('inactivityMode') as InactivityMode) ?? 'off';
    const inactivityTimeoutMs =
      (storage.getNumber('inactivityTimeoutMs') as TimeoutMs) ?? 30 * 60 * 1000;
    const showAdvancedSettings =
      storage.getBoolean('showAdvancedSettings') ?? false;
    const canCopyIntentionText =
      storage.getBoolean('canCopyIntentionText') ?? false;
    const breathAnimationIntensity =
      (storage.getString(
        'breathAnimationIntensity'
      ) as BreathAnimationIntensity) ?? 'minimal';
    const directToSettings = storage.getBoolean('directToSettings') ?? false;
    const debugLogging = storage.getBoolean('debugLogging') ?? false;

    return {
      intentions: intentionsJson ? JSON.parse(intentionsJson) : [],
      fuzzyMatching,
      inactivityMode,
      inactivityTimeoutMs,
      showAdvancedSettings,
      canCopyIntentionText,
      breathAnimationIntensity,
      directToSettings,
      debugLogging,
    };
  },

  set(
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
    if ('intentions' in data) {
      storage.set('intentions', JSON.stringify(data.intentions));
    }
    if ('fuzzyMatching' in data) {
      storage.set('fuzzyMatching', data.fuzzyMatching);
    }
    if ('inactivityMode' in data) {
      storage.set('inactivityMode', data.inactivityMode);
    }
    if ('inactivityTimeoutMs' in data) {
      storage.set('inactivityTimeoutMs', data.inactivityTimeoutMs);
    }
    if ('showAdvancedSettings' in data) {
      storage.set('showAdvancedSettings', data.showAdvancedSettings);
    }
    if ('canCopyIntentionText' in data) {
      storage.set('canCopyIntentionText', data.canCopyIntentionText);
    }
    if ('breathAnimationIntensity' in data) {
      storage.set('breathAnimationIntensity', data.breathAnimationIntensity);
    }
    if ('directToSettings' in data) {
      storage.set('directToSettings', data.directToSettings);
    }
    if ('debugLogging' in data) {
      storage.set('debugLogging', data.debugLogging);
    }
  },
};
