// Test setup file
import 'fast-check';

declare global {
  var browser: any;
}

// Mock browser APIs for testing
global.browser = {
  storage: {
    local: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
    },
    sync: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
    },
    onChanged: {
      addListener: () => {},
      removeListener: () => {},
    },
  },
  runtime: {
    getURL: (path: string) => `chrome-extension://test/${path}`,
    getBrowserInfo: undefined, // Not Firefox in tests
  },
  idle: {
    setDetectionInterval: () => {},
    onStateChanged: {
      addListener: () => {},
      removeListener: () => {},
    },
  },
  tabs: {
    query: () => Promise.resolve([]),
    create: () => Promise.resolve({} as any),
    update: () => Promise.resolve({} as any),
  },
};

// Mock chrome.storage.session for Chrome (used in storage.ts detection)
(
  globalThis as {
    chrome?: { storage?: { session?: typeof global.browser.storage.local } };
  }
).chrome = {
  storage: {
    session: global.browser.storage.local,
  },
};
