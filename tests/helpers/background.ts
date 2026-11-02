import { vi } from 'vitest';
import type { InactivityMode } from '../../src/components/storage';

function event() {
  const listeners = new Set<(...args: any[]) => unknown>();
  return {
    addListener: (listener: (...args: any[]) => unknown) =>
      listeners.add(listener),
    removeListener: (listener: (...args: any[]) => unknown) =>
      listeners.delete(listener),
    emit: async (...args: any[]) => {
      for (const listener of [...listeners]) await listener(...args);
    },
  };
}

export type TestTab = {
  id: number;
  windowId: number;
  active: boolean;
  url: string;
  audible?: boolean;
  mutedInfo?: { muted: boolean };
};
export async function startBackground(
  options: {
    url?: string;
    mode?: InactivityMode;
    extraTabs?: TestTab[];
    session?: Record<string, unknown>;
  } = {}
) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(100000);
  const tabs: TestTab[] = [
    {
      id: 1,
      windowId: 1,
      active: true,
      url: options.url ?? 'https://example.com/',
    },
    ...(options.extraTabs ?? []),
  ];
  const windows = [...new Set(tabs.map(tab => tab.windowId))].map(id => ({
    id,
    focused: id === 1,
  }));
  const settings = {
    intentions: [
      { id: 'rule-1', url: 'example.com/protected', phrase: 'My intention' },
    ],
    inactivityMode: options.mode ?? 'off',
    inactivityTimeoutMs: 1000,
  };
  const session = { ...options.session };
  const redirects: { tabId: number; url: string }[] = [];
  const browser = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onSuspend: event(),
      onMessage: event(),
    },
    storage: {
      sync: {
        get: async (defaults: object) => ({ ...defaults, ...settings }),
        set: async (data: object) => Object.assign(settings, data),
      },
      local: { get: async () => ({}), set: async () => {} },
      session: {
        get: async () => ({ ...session }),
        set: async (data: object) => Object.assign(session, data),
      },
      onChanged: event(),
    },
    tabs: {
      query: async (query: {
        active?: boolean;
        windowId?: number;
        audible?: boolean;
      }) =>
        tabs.filter(
          tab =>
            (query.active === undefined || tab.active === query.active) &&
            (query.windowId === undefined || tab.windowId === query.windowId) &&
            (query.audible === undefined || !!tab.audible === query.audible)
        ),
      get: async (id: number) => tabs.find(tab => tab.id === id),
      update: async (tabId: number, update: { url: string }) => {
        redirects.push({ tabId, url: update.url });
        return tabs.find(tab => tab.id === tabId);
      },
      remove: async (id: number) => {
        tabs.splice(
          tabs.findIndex(tab => tab.id === id),
          1
        );
      },
      onActivated: event(),
      onUpdated: event(),
      onCreated: event(),
      onRemoved: event(),
      onReplaced: event(),
    },
    windows: {
      getAll: async () => windows,
      onFocusChanged: event(),
      onRemoved: event(),
    },
    idle: { setDetectionInterval: () => {}, onStateChanged: event() },
    webNavigation: {
      onBeforeNavigate: event(),
      onCommitted: event(),
      onHistoryStateUpdated: event(),
      onReferenceFragmentUpdated: event(),
      onErrorOccurred: event(),
    },
  };
  vi.doMock('webextension-polyfill', () => ({ default: browser }));
  vi.stubGlobal('chrome', browser);
  vi.stubGlobal('__IS_DEV__', false);
  vi.stubGlobal('defineBackground', (init: () => Promise<void>) => init);
  const init = (await import('../../src/entrypoints/background')).default;
  await init();
  const before = (url: string, tabId = 1) =>
    browser.webNavigation.onBeforeNavigate.emit({ tabId, frameId: 0, url });
  const commit = async (url: string, tabId = 1) => {
    tabs.find(tab => tab.id === tabId)!.url = url;
    await browser.webNavigation.onCommitted.emit({ tabId, frameId: 0, url });
  };
  const navigate = async (url: string, tabId = 1) => {
    await before(url, tabId);
    await commit(url, tabId);
  };
  const history = async (url: string, tabId = 1) => {
    const tab = tabs.find(tab => tab.id === tabId)!;
    tab.url = url;
    await browser.tabs.onUpdated.emit(tabId, { url }, tab);
    await browser.webNavigation.onHistoryStateUpdated.emit({
      tabId,
      frameId: 0,
      url,
    });
  };
  const focus = async (windowId: number) => {
    windows.forEach(window => {
      window.focused = window.id === windowId;
    });
    await browser.windows.onFocusChanged.emit(windowId);
  };
  const changeRules = async (intentions: typeof settings.intentions) => {
    settings.intentions = intentions;
    await browser.storage.onChanged.emit(
      { intentions: { newValue: intentions } },
      'sync'
    );
  };
  return {
    browser,
    tabs,
    windows,
    settings,
    session,
    redirects,
    before,
    commit,
    navigate,
    history,
    focus,
    changeRules,
  };
}
