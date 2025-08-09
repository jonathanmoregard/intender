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
  msToSeconds,
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

function shouldTriggerInactivity(
  intentionScopeId: IntentionScopeId,
  mode: InactivityMode,
  timeoutMs: TimeoutMs
): boolean {
  if (mode === 'off') return false;
  const lastActive = lastActiveByScope.get(intentionScopeId);
  if (!lastActive) return false;
  const now = createTimestamp();
  const isInactive = now - lastActive > (timeoutMs as number);
  console.log('[Intender] Inactivity check:', {
    intentionScopeId,
    lastActive,
    now,
    timeoutMs,
    isInactive,
  });
  return isInactive;
}
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

      if (
        shouldTriggerInactivity(
          intentionScopeId,
          settingsCache.inactivityMode,
          settingsCache.inactivityTimeoutMs
        )
      ) {
        console.log(
          '[Intender] Triggering revalidation for inactive intention scope:',
          intentionScopeId
        );

        const intentionPageUrl = browser.runtime.getURL(
          'intention-page.html?target=' +
            encodeURIComponent(url) +
            '&intentionScopeId=' +
            encodeURIComponent(intentionScopeId)
        );

        try {
          await browser.tabs.update(tabId, { url: intentionPageUrl });
        } catch (error) {
          console.log('[Intender] Failed to redirect for revalidation:', error);
        }
      } else {
        // Update activity on focus
        updateIntentionScopeActivity(intentionScopeId);
      }
    });

    // Handle audio state changes
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.audible !== undefined) {
        const url = tabUrlMap.get(numberToTabId(tabId));
        if (!url) return;

        const intentionScopeId = lookupIntentionScopeId(url);
        if (!intentionScopeId) return;

        if (changeInfo.audible) {
          console.log('[Intender] Tab became audible, resetting activity:', {
            tabId,
            intentionScopeId,
          });
          updateIntentionScopeActivity(intentionScopeId);
        } else {
          console.log('[Intender] Tab stopped being audible:', {
            tabId,
            intentionScopeId,
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
    tabUrlMap.delete(numberToTabId(tabId));
    intentionScopePerTabId.delete(numberToTabId(tabId));
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
  const MIN_IDLE_DETECTION_SECONDS = 15;
  function updateIdleDetectionInterval(timeoutMs: TimeoutMs): void {
    try {
      const seconds = Math.max(
        MIN_IDLE_DETECTION_SECONDS,
        msToSeconds(timeoutMs)
      );
      chrome.idle.setDetectionInterval(seconds);
    } catch (e) {
      console.log('[Intender] Failed to set idle detection interval:', e);
    }
  }

  chrome.idle.onStateChanged.addListener(
    async (newState: chrome.idle.IdleState) => {
      if (newState !== 'idle') return;
      await inactivityCheck();
    }
  );

  // E2E only: force the same logic as idle without relying on OS idle in automation.
  // Rationale: In MV3 tests, timers can be suspended and OS idle often doesn't flip.
  // This hook lets tests trigger the same per-scope path from an extension page.
  browser.runtime.onMessage.addListener(async (message: unknown) => {
    const msg = message as { type?: string } | null | undefined;
    if (!msg || msg.type !== 'e2e:forceInactivityCheck') return;
    await inactivityCheck();
  });

  // Shared: perform inactivity check for the focused tab and revalidate if needed
  async function inactivityCheck(): Promise<void> {
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
      if (
        shouldTriggerInactivity(
          intentionScopeId,
          settingsCache.inactivityMode,
          settingsCache.inactivityTimeoutMs
        )
      ) {
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
      }
    } catch (error) {
      console.log('[Intender] Inactivity check failed:', error);
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
      }
    } catch (error) {
      console.error('[Intender] Failed handling storage change:', error);
    }
  });
});
