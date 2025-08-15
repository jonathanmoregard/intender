/// <reference types="chrome-types" />

export {};

declare global {
  interface Window {
    chrome: typeof chrome;
    __waitForStorageChange?: Promise<void>;
  }
}
