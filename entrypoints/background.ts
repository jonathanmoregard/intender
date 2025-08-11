import { Brand } from 'ts-brand';
import browser from 'webextension-polyfill';
import { mapNulls } from '../components/helpers';
import {
  createIntentionIndex,
  intentionToIntentionScopeId,
  lookupIntention,
  parseIntention,
  type IntentionIndex,
  type IntentionScopeId,
} from '../components/intention';
import {
  normalizeUrl,
  parseUrlString,
  toComponents,
} from '../components/normalized-url';
import { storage, type InactivityMode } from '../components/storage';
import {
  createTimestamp,
  minutesToMs,
  type TimeoutMs,
  type Timestamp,
} from '../components/time';

type SettingsCache = Readonly<{
  inactivityMode: InactivityMode;
  inactivityTimeoutMs: TimeoutMs;
}>;

// Branded type for tab ID
export type TabId = Brand<number, 'TabId'>;

// Helper functions for TabId
function numberToTabId(num: number): TabId {
  return num as TabId;
}

// Tab URL cache to track last-known URLs for each tab
const tabUrlMap = new Map<TabId, string>();

// Inactivity tracking
const lastActiveByScope = new Map<IntentionScopeId, Timestamp>();
const intentionScopePerTabId = new Map<TabId, IntentionScopeId>();
const audibleTabsByScope = new Map<IntentionScopeId, Set<TabId>>();

function markTabAudible(scopeId: IntentionScopeId, tabId: TabId): void {
  let set = audibleTabsByScope.get(scopeId);
  if (!set) {
    set = new Set<TabId>();
    audibleTabsByScope.set(scopeId, set);
  }
  set.add(tabId);
}

function unmarkTabAudible(scopeId: IntentionScopeId, tabId: TabId): void {
  const set = audibleTabsByScope.get(scopeId);
  if (!set) return;
  set.delete(tabId);
  if (set.size === 0) audibleTabsByScope.delete(scopeId);
}

function isScopeAudible(scopeId: IntentionScopeId): boolean {
  const set = audibleTabsByScope.get(scopeId);
  return !!set && set.size > 0;
}

const getDomain = (input: string): string => {
  const url = parseUrlString(input);
  if (!url) return '';
  const normalized = normalizeUrl(url);
  const comps = toComponents(normalized);
  return comps.domain || '';
};

const domainEquals = (url1: string, url2: string): boolean => {
  const domain1 = getDomain(url1);
  const domain2 = getDomain(url2);
  return domain1 === domain2 && domain1 !== '';
};

// Update activity for an intention scope
const updateIntentionScopeActivity = (intentionScopeId: IntentionScopeId) => {
  lastActiveByScope.set(intentionScopeId, createTimestamp());
  console.log(
    '[Intender] Updated activity for intention scope:',
    intentionScopeId
  );
};

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export default defineBackground(async () => {
  // Cache data that won't change during session
  let intentionIndex: IntentionIndex = createIntentionIndex([]);
  const intentionPageUrl = browser.runtime.getURL('intention-page.html');
  // Immutable settings cache (read by listeners, written only here and on storage changes)
  let settingsCache: SettingsCache = Object.freeze({
    inactivityMode: 'off',
    inactivityTimeoutMs: minutesToMs(30) as TimeoutMs,
  });

  // E2E: test control flag must be initialized before any calls that read it
  let e2eDisableIdleListener = false;

  // Get intention scope ID for a URL (outside try so polling can use it)
  const lookupIntentionScopeId = (url: string): IntentionScopeId | null => {
    const matchedIntention = lookupIntention(url, intentionIndex);
    if (!matchedIntention) return null;
    return intentionToIntentionScopeId(matchedIntention);
  };

  // Load intentions and settings on startup
  try {
    const {
      intentions,
      inactivityMode = 'off',
      inactivityTimeoutMs = minutesToMs(30),
    } = await storage.get();
    const parsedIntentions = mapNulls(parseIntention, intentions);
    intentionIndex = createIntentionIndex(parsedIntentions);

    settingsCache = Object.freeze({
      inactivityMode: inactivityMode as InactivityMode,
      inactivityTimeoutMs: inactivityTimeoutMs as TimeoutMs,
    });
    updateIdleDetectionInterval(settingsCache.inactivityTimeoutMs);
    toggleIdleDetection(settingsCache.inactivityMode);

    // Set up event listeners with access to the functions
    browser.tabs.onActivated.addListener(async activeInfo => {
      const tabId = numberToTabId(activeInfo.tabId);
      const url = tabUrlMap.get(tabId);
      if (!url) return;

      const intentionScopeId = lookupIntentionScopeId(url);
      if (!intentionScopeId) return;

      console.log('[Intender] Tab focus event:', {
        tabId,
        url,
        intentionScopeId,
      });

      // On focus, always update activity for the scope
      updateIntentionScopeActivity(intentionScopeId);
    });

    // Handle audio state changes
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.audible !== undefined) {
        const tId = numberToTabId(tabId);
        const url = tabUrlMap.get(tId);
        const intentionScopeId = url ? lookupIntentionScopeId(url) : null;

        if (changeInfo.audible) {
          if (intentionScopeId) markTabAudible(intentionScopeId, tId);
          console.log('[Intender] Tab became audible, resetting activity:', {
            tabId,
            intentionScopeId: intentionScopeId || 'unknown',
          });
          if (intentionScopeId) updateIntentionScopeActivity(intentionScopeId);
        } else {
          if (intentionScopeId) unmarkTabAudible(intentionScopeId, tId);
          console.log('[Intender] Tab stopped being audible:', {
            tabId,
            intentionScopeId: intentionScopeId || 'unknown',
          });
        }
      }
    });
  } catch (error) {
    console.error('[Intender] Failed to load intentions on startup:', error);
  }

  // Track new tabs to initialize cache
  browser.tabs.onCreated.addListener(tab => {
    if (tab.id !== undefined && typeof tab.url === 'string') {
      tabUrlMap.set(numberToTabId(tab.id), tab.url);
      console.log('[Intender] Tab created, cached URL:', {
        tabId: tab.id,
        url: tab.url,
      });
    }
  });

  // Update cache when navigation is committed (reliable source of truth)
  browser.webNavigation.onCommitted.addListener(details => {
    if (details.frameId === 0) {
      // Only track main frame navigation
      tabUrlMap.set(numberToTabId(details.tabId), details.url);
      console.log('[Intender] Navigation committed, updated cache:', {
        tabId: details.tabId,
        url: details.url,
      });

      // If the destination URL matches an intention, record scope per tab and mark activity
      const matched = lookupIntention(details.url, intentionIndex);
      if (matched) {
        const scopeId = intentionToIntentionScopeId(matched);
        intentionScopePerTabId.set(numberToTabId(details.tabId), scopeId);
        updateIntentionScopeActivity(scopeId);
      }
    }
  });

  // Clean up cache when tabs are removed
  browser.tabs.onRemoved.addListener(tabId => {
    const tId = numberToTabId(tabId);
    const scope = intentionScopePerTabId.get(tId);
    // If this tab was marked audible for a scope, decrement
    if (scope) {
      const set = audibleTabsByScope.get(scope);
      if (set && set.has(tId)) {
        set.delete(tId);
        if (set.size === 0) audibleTabsByScope.delete(scope);
      }
    }
    tabUrlMap.delete(tId);
    intentionScopePerTabId.delete(tId);
    console.log('[Intender] Tab removed, cleared cache:', { tabId });
  });

  browser.webNavigation.onBeforeNavigate.addListener(async details => {
    if (details.frameId !== 0) return;

    const targetUrl = details.url;
    const sourceUrl = tabUrlMap.get(numberToTabId(details.tabId)) || null;

    let activeTabs: browser.Tabs.Tab[];
    try {
      activeTabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
    } catch (error) {
      console.log(
        '[Intender] Failed to query active tabs, treating as different tab:',
        error
      );
      activeTabs = [];
    }

    const navigationTabId = details.tabId;
    const activeTabId = activeTabs[0]?.id;
    const activeTabUrl = activeTabs[0]?.url;

    // If no active tab (window unfocused), treat as different tab to be safe
    const isNavigationTabActive =
      activeTabId === navigationTabId && activeTabs.length > 0;

    // Development logging
    console.log('[Intender] Navigation check:', {
      targetUrl,
      sourceUrl: sourceUrl || 'null',
      sourceTabId: details.tabId,
      navigationTabId,
      activeTabId,
      activeTabUrl: activeTabUrl || 'null',
      isNavigationTabActive,
      frameId: details.frameId,
    });

    // Rule 1: If navigating from same domain → same domain, allow
    if (sourceUrl && domainEquals(sourceUrl, targetUrl)) {
      console.log('[Intender] Rule 1: Same domain navigation, allowing');
      return;
    }

    // Rule 2: If origin is intention page, allow
    if (sourceUrl && sourceUrl.startsWith(intentionPageUrl)) {
      console.log('[Intender] Rule 2: Origin is intention page, allowing');
      return;
    }

    // Rule 3: If active tab is on same domain as target (and not same tab), allow
    // This handles cases like:
    // - Opening new tab from Facebook (active tab is Facebook) → navigating to Facebook
    // - Duplicating Facebook tab (active tab is Facebook) → navigating within Facebook
    // - Middle-click link from Facebook (active tab is Facebook) → opening Facebook link
    // The !== check is to avoid allowing everything. Without it,
    // navigation that is happening in the active tab would always pass

    if (
      !isNavigationTabActive &&
      activeTabUrl &&
      domainEquals(activeTabUrl, targetUrl)
    ) {
      console.log('[Intender] Rule 3: Active tab on same domain, allowing');
      return;
    }

    // Rule 4: Otherwise, check if we need to block using new matching system
    const matchedIntention = lookupIntention(targetUrl, intentionIndex);

    if (matchedIntention) {
      console.log(
        '[Intender] Rule 4: Blocking navigation, showing intention page for:',
        matchedIntention
      );

      // Track the intention scope for this tab
      const intentionScopeId = intentionToIntentionScopeId(matchedIntention);
      intentionScopePerTabId.set(
        numberToTabId(details.tabId),
        intentionScopeId
      );
      updateIntentionScopeActivity(intentionScopeId);

      const redirectUrl = browser.runtime.getURL(
        'intention-page.html?target=' +
          encodeURIComponent(targetUrl) +
          '&intentionScopeId=' +
          encodeURIComponent(matchedIntention.id)
      );

      try {
        await browser.tabs.update(details.tabId, { url: redirectUrl });
      } catch (error) {
        // Tab might be gone, ignore the error
        console.log('[Intender] Tab update failed, tab may be closed:', error);
      }
    }
  });

  // Idle-based inactivity for focused tab

  function updateIdleDetectionInterval(timeoutMs: TimeoutMs): void {
    const timeoutSeconds = Math.max(15, Math.floor(timeoutMs / 1000));
    try {
      chrome.idle.setDetectionInterval(timeoutSeconds);
    } catch (e) {
      console.log('[Intender] Failed to set idle detection interval:', e);
    }
  }

  function toggleIdleDetection(mode: InactivityMode): void {
    if (mode === 'off' || e2eDisableIdleListener) {
      chrome.idle.onStateChanged.removeListener(inactivityChange);
    } else {
      chrome.idle.onStateChanged.addListener(inactivityChange);
    }
  }

  // E2E only: force the same logic as idle without relying on OS idle in automation.
  // Rationale: In MV3 tests, timers can be suspended and OS idle often doesn't flip.
  // This hook lets tests trigger the same per-scope path from an extension page.
  browser.runtime.onMessage.addListener(async (message: unknown) => {
    const msg = message as { type?: string } | null | undefined;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'e2e:forceInactivityCheck-idle') {
      e2eDisableIdleListener = true;
      toggleIdleDetection(settingsCache.inactivityMode);
      await inactivityChange('idle');
    } else if (msg.type === 'e2e:forceInactivityCheck-active') {
      e2eDisableIdleListener = true;
      toggleIdleDetection(settingsCache.inactivityMode);
      await inactivityChange('active');
    } else {
      return;
    }
  });

  async function inactivityChange(
    newState: chrome.idle.IdleState
  ): Promise<void> {
    if (newState === 'idle') {
      try {
        if (settingsCache.inactivityMode === 'off') return;

        const [activeTab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab || typeof activeTab.id !== 'number') return;

        const tabId = numberToTabId(activeTab.id);
        const cachedUrl = tabUrlMap.get(tabId);
        const url =
          cachedUrl || (typeof activeTab.url === 'string' ? activeTab.url : '');
        if (!url) return;

        const intentionScopeId =
          intentionScopePerTabId.get(tabId) || lookupIntentionScopeId(url);
        if (!intentionScopeId) return;

        // Check audio exemption
        if (settingsCache.inactivityMode === 'all-except-audio') {
          if (isScopeAudible(intentionScopeId)) return;
        }

        // Redirect to intention page
        const redirect = browser.runtime.getURL(
          'intention-page.html?target=' +
            encodeURIComponent(url) +
            '&intentionScopeId=' +
            encodeURIComponent(intentionScopeId)
        );

        try {
          await browser.tabs.update(activeTab.id, { url: redirect });
        } catch (error) {
          console.log('[Intender] Redirect failed:', error);
        }
      } catch (error) {
        console.log('[Intender] Inactivity check failed:', error);
      }
      return;
    }

    if (newState === 'active') {
      try {
        const [activeTab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab || typeof activeTab.id !== 'number') return;

        const tId = numberToTabId(activeTab.id);
        const cachedUrl = tabUrlMap.get(tId);
        const url =
          cachedUrl || (typeof activeTab.url === 'string' ? activeTab.url : '');
        if (!url) return;

        const scope =
          intentionScopePerTabId.get(tId) || lookupIntentionScopeId(url);
        if (scope) updateIntentionScopeActivity(scope);
      } catch (error) {
        console.log('[Intender] Idle active mark failed:', error);
      }
    }
  }

  // Refresh cached intentions and inactivity settings when storage changes
  browser.storage.onChanged.addListener(async changes => {
    try {
      // Intentions updated → rebuild index
      if (changes.intentions) {
        const { intentions } = await storage.get();
        const parsedIntentions = mapNulls(parseIntention, intentions);
        intentionIndex = createIntentionIndex(parsedIntentions);
      }

      // Inactivity settings updated → refresh snapshot and idle interval
      if (changes.inactivityMode || changes.inactivityTimeoutMs) {
        const { inactivityMode, inactivityTimeoutMs } = await storage.get();
        settingsCache = Object.freeze({
          inactivityMode: (inactivityMode ??
            settingsCache.inactivityMode) as InactivityMode,
          inactivityTimeoutMs: (inactivityTimeoutMs ??
            settingsCache.inactivityTimeoutMs) as TimeoutMs,
        });
        updateIdleDetectionInterval(settingsCache.inactivityTimeoutMs);
        toggleIdleDetection(settingsCache.inactivityMode);
      }
    } catch (error) {
      console.error('[Intender] Failed handling storage change:', error);
    }
  });
});
