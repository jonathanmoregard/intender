import browser from 'webextension-polyfill';
import {
  defaultSettings,
  parseSettingsPatch,
  readStoredSettings,
  type Settings,
} from './settings-data';

export type {
  InactivityMode,
  BreathAnimationIntensity,
  Settings,
} from './settings-data';

declare const __IS_DEV__: boolean;

const backend = __IS_DEV__ ? browser.storage.local : browser.storage.sync;
let pendingWrite: Promise<void> = Promise.resolve();

export const storage = {
  async get(): Promise<Settings> {
    await pendingWrite;
    return readStoredSettings(await backend.get({ ...defaultSettings }));
  },
  async set(data: Partial<Settings>): Promise<void> {
    const patch = parseSettingsPatch(data);
    // Preserve invocation order even when the backend completes asynchronously.
    // In particular, an in-flight autosave must finish before a newer import.
    const write = pendingWrite.then(() => backend.set(patch));
    pendingWrite = write.catch(() => {});
    await write;
  },
};
