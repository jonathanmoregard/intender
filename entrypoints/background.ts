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

// Branded type for window ID
export type WindowId = Brand<number, 'WindowId'>;

// Helper functions for TabId
function numberToTabId(num: number): TabId {
  return num as TabId;
}

// Helper functions for WindowId
function numberToWindowId(num: number): WindowId {
  return num as WindowId;
}

// Tab URL cache to track last-known URLs for each tab
const tabUrlMap = new Map<TabId, string>();

// Inactivity tracking
const lastActiveByScope = new Map<IntentionScopeId, Timestamp>();
const intentionScopePerTabId = new Map<TabId, IntentionScopeId>();
const lastActiveTabIdByWindow = new Map<WindowId, TabId>();
// never -1, ignore non proper browser windows
let lastFocusedWindowId: WindowId | null = null;
const lastRedirectAtByTabId = new Map<TabId, Timestamp>();

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

  // Check if a scope has any audible tabs on-demand
  async function isScopeAudible(scopeId: IntentionScopeId): Promise<boolean> {
    try {
      // Build a set of tab IDs in the given scope without intermediate arrays
      const scopeTabIds = new Set<TabId>();
      for (const [tabId, scope] of intentionScopePerTabId) {
        if (scope === scopeId) scopeTabIds.add(tabId);
      }
      if (scopeTabIds.size === 0) return false;

      // Get all audible tabs and check for any overlap
      const audibleTabs = await browser.tabs.query({ audible: true });
      return audibleTabs.some(
        tab =>
          tab.id != null &&
          scopeTabIds.has(tab.id as TabId) &&
          tab.mutedInfo?.muted === false
      );
    } catch (error) {
      console.error('[Intender] Failed to check scope audibility:', error);
      return false;
    }
  }

  // Get intention scope ID for a tab with comprehensive resolution
  const getScopeForTab = (
    tabId: TabId,
    url?: string
  ): IntentionScopeId | null => {
    // Resolution order per spec:
    // 1. intentionScopePerTabId if present
    const mappedScope = intentionScopePerTabId.get(tabId);
    if (mappedScope) {
      console.log('[Intender] getScopeForTab: mapped scope', {
        tabId,
        mappedScope,
      });
      return mappedScope;
    }

    // 2. derive via tabUrlMap → scope lookup
    const cachedUrl = tabUrlMap.get(tabId);
    const resolvedUrl = url || cachedUrl;
    if (resolvedUrl) {
      const scopeFromUrl = lookupIntentionScopeId(resolvedUrl);
      console.log('[Intender] getScopeForTab: from URL', {
        tabId,
        url: resolvedUrl,
        scopeFromUrl: scopeFromUrl || null,
      });
      return scopeFromUrl;
    }

    // 3. otherwise return null
    console.log('[Intender] getScopeForTab: unresolved', { tabId });
    return null;
  };

  // Check if a scope should trigger inactivity intention check
  async function shouldTriggerInactivityIntentionCheck(
    mode: InactivityMode,
    scopeId: IntentionScopeId | null,
    timeoutMs: TimeoutMs
  ): Promise<boolean> {
    if (mode === 'off' || !scopeId) return false;

    // Check audio exemption for all-except-audio mode
    if (mode === 'all-except-audio' && (await isScopeAudible(scopeId))) {
      return false;
    }

    // Check if scope has been inactive long enough
    const lastActive = lastActiveByScope.get(scopeId);
    if (!lastActive) {
      // First-seen scope: return false (will be handled by normal bump path)
      return false;
    }

    const now = createTimestamp();
    const isInactive = now - lastActive >= (timeoutMs as number);

    console.log('[Intender] Inactivity check:', {
      scopeId,
      lastActive,
      now,
      timeoutMs,
      isInactive,
      mode,
    });

    return isInactive;
  }

  // Unified focus handling with same-scope fast path
  async function handleFocusChange({
    fromTabId,
    toTabId,
    toUrl,
    windowId,
  }: {
    fromTabId?: TabId;
    toTabId: TabId;
    toUrl?: string;
    windowId: WindowId;
  }): Promise<void> {
    // Snapshot of window → last active tab mapping prior to handling
    try {
      const mapSnapshot = Array.from(lastActiveTabIdByWindow.entries()).map(
        ([w, t]) => ({
          windowId: w as unknown as number,
          tabId: t as unknown as number,
        })
      );
      console.log(
        '[Intender] handleFocusChange - lastActiveTabIdByWindow map snapshot',
        mapSnapshot
      );
    } catch {}

    // Update tracking
    lastActiveTabIdByWindow.set(windowId, toTabId);
    console.log('[Intender] Updated lastActiveTabIdByWindow', {
      windowId,
      toTabId,
    });

    // Compute scopes for both tabs
    const fromScope = fromTabId ? getScopeForTab(fromTabId) : null;
    const toScope = getScopeForTab(toTabId, toUrl);

    console.log('[Intender] Focus change:', {
      windowId,
      fromTabId,
      toTabId,
      toUrl,
      fromScope,
      toScope,
      scopeComparison: fromScope === toScope ? 'SAME' : 'DIFFERENT',
    });

    // Debug: log scope activity states
    if (fromScope) {
      const fromActivity = lastActiveByScope.get(fromScope);
      console.log('[Intender] From scope activity:', {
        scope: fromScope,
        lastActive: fromActivity,
        ageMs: fromActivity ? createTimestamp() - fromActivity : 'never',
      });
    }
    if (toScope) {
      const toActivity = lastActiveByScope.get(toScope);
      console.log('[Intender] To scope activity:', {
        scope: toScope,
        lastActive: toActivity,
        ageMs: toActivity ? createTimestamp() - toActivity : 'never',
      });
    }

    // FAST PATH: Same-scope switch - skip inactivity check entirely
    if (fromScope && toScope && fromScope === toScope) {
      console.log('[Intender] Same-scope switch detected, fast path:', {
        scope: toScope,
        fromScope,
        toScope,
        scopesEqual: fromScope === toScope,
      });
      // Bump activity for the scope and update tracking
      updateIntentionScopeActivity(toScope);
      return;
    } else {
      console.log('[Intender] NOT same-scope switch:', {
        fromScope,
        toScope,
        bothPresent: !!(fromScope && toScope),
        scopesEqual: fromScope === toScope,
      });
    }

    // From bump: update activity for the previous tab's scope
    if (fromTabId && fromScope) {
      updateIntentionScopeActivity(fromScope);
      console.log('[Intender] Focus from bump:', {
        windowId,
        fromTabId,
        fromScope,
      });
    }

    // Guard: if the target tab URL is already the intention page URL, skip redirect
    const resolvedUrl = toUrl || tabUrlMap.get(toTabId);
    if (resolvedUrl && resolvedUrl.startsWith(intentionPageUrl)) {
      console.log(
        '[Intender] Target tab already on intention page, skipping redirect'
      );
      return;
    }

    // Check if we should trigger inactivity intention check
    if (
      await shouldTriggerInactivityIntentionCheck(
        settingsCache.inactivityMode,
        toScope,
        settingsCache.inactivityTimeoutMs
      )
    ) {
      console.log(
        '[Intender] Triggering inactivity redirect for scope:',
        toScope
      );

      if (resolvedUrl && toScope) {
        await redirectToIntentionPage(toTabId, resolvedUrl, toScope);
      }
    } else if (toScope) {
      // No redirect needed, just update activity
      updateIntentionScopeActivity(toScope);
    }
  }

  // Central helper to redirect to intention page with cooldown protection
  async function redirectToIntentionPage(
    tabId: TabId,
    targetUrl: string,
    toScope: IntentionScopeId
  ): Promise<boolean> {
    const REDIRECT_COOLDOWN_MS = 500;
    const now = createTimestamp();
    const lastRedirect = lastRedirectAtByTabId.get(tabId);

    // Check cooldown
    if (lastRedirect && now - lastRedirect < REDIRECT_COOLDOWN_MS) {
      console.log('[Intender] Redirect cooldown active, skipping:', {
        tabId,
        lastRedirect,
        now,
        cooldownMs: REDIRECT_COOLDOWN_MS,
      });
      return false;
    }

    const redirectUrl = browser.runtime.getURL(
      'intention-page.html?target=' +
        encodeURIComponent(targetUrl) +
        '&intentionScopeId=' +
        encodeURIComponent(toScope)
    );

    try {
      await browser.tabs.update(tabId, { url: redirectUrl });
      lastRedirectAtByTabId.set(tabId, now);
      console.log('[Intender] Redirected to intention page:', {
        tabId,
        targetUrl,
        toScope,
      });
      return true;
    } catch (error) {
      console.log('[Intender] Failed to redirect to intention page:', error);
      return false;
    }
  }

  // Initialize window focus tracking
  try {
    const windows = await browser.windows.getAll();
    const focusedWindow = windows.find(w => w.focused);
    if (focusedWindow && typeof focusedWindow.id === 'number') {
      lastFocusedWindowId = numberToWindowId(focusedWindow.id);
      console.log(
        '[Intender] Initialized focused window:',
        lastFocusedWindowId
      );

      // Seed lastActiveTabIdByWindow for the focused window
      try {
        const [activeTab] = await browser.tabs.query({
          active: true,
          windowId: focusedWindow.id,
        });
        if (activeTab && typeof activeTab.id === 'number') {
          const activeTabId = numberToTabId(activeTab.id);
          lastActiveTabIdByWindow.set(lastFocusedWindowId, activeTabId);
          console.log('[Intender] Seeded active tab for focused window:', {
            windowId: lastFocusedWindowId,
            tabId: activeTabId,
          });
        }
      } catch (tabError) {
        console.log('[Intender] Failed to seed active tab:', tabError);
      }
    }
  } catch (error) {
    console.log('[Intender] Failed to initialize window focus:', error);
  }

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
      const windowId = numberToWindowId(activeInfo.windowId);
      const toTabId = numberToTabId(activeInfo.tabId);

      // Track previous active per window (from tab handling)
      const fromTabId = lastActiveTabIdByWindow.get(windowId);

      // Skip if same tab (spurious re-activation)
      if (fromTabId && fromTabId === toTabId) return;

      // Get the URL for the "to" tab
      const toUrl = tabUrlMap.get(toTabId);

      // Diagnostic: explicit tab focus event log
      const toScopeForLog = getScopeForTab(toTabId, toUrl);
      console.log('[Intender] Tab focus event:', {
        windowId,
        fromTabId,
        toTabId,
        toUrl: toUrl || '',
        toScope: toScopeForLog,
      });

      // Use unified focus handler
      await handleFocusChange({
        fromTabId,
        toTabId,
        toUrl,
        windowId,
      });
    });

    // Handle audio state changes
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      const tId = numberToTabId(tabId);

      // Update URL cache when available to keep it fresher between webNavigation commits
      if (changeInfo.url) {
        tabUrlMap.set(tId, changeInfo.url);
        console.log('[Intender] Tab URL updated via onUpdated:', {
          tabId,
          url: changeInfo.url,
        });
      }

      const intentionScopeId = getScopeForTab(tId);

      // Handle audible state changes - update activity when audio starts/stops
      if (changeInfo.audible !== undefined) {
        if (changeInfo.audible) {
          console.log('[Intender] Tab became audible, resetting activity:', {
            tabId,
            intentionScopeId: intentionScopeId || 'unknown',
          });
          if (intentionScopeId) updateIntentionScopeActivity(intentionScopeId);
        } else {
          console.log('[Intender] Tab stopped being audible:', {
            tabId,
            intentionScopeId: intentionScopeId || 'unknown',
          });
          if (intentionScopeId) updateIntentionScopeActivity(intentionScopeId);
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
    // Only track main frame navigation
    if (details.frameId !== 0) {
      return;
    }

    const tabId = numberToTabId(details.tabId);
    tabUrlMap.set(tabId, details.url);

    console.log('[Intender] Navigation committed, updated cache:', {
      tabId: details.tabId,
      url: details.url,
    });

    // If the destination URL matches an intention, record scope per tab and mark activity
    const matched = lookupIntention(details.url, intentionIndex);
    if (matched) {
      const scopeId = intentionToIntentionScopeId(matched);
      intentionScopePerTabId.set(tabId, scopeId);
      updateIntentionScopeActivity(scopeId);
      console.log(
        '[Intender] Navigation committed to scoped page, set scope:',
        {
          tabId: details.tabId,
          scopeId,
        }
      );
    } else {
      // Clear scope mapping when navigating away from scoped pages
      const priorScope = intentionScopePerTabId.get(tabId);
      if (priorScope) {
        intentionScopePerTabId.delete(tabId);
        console.log(
          '[Intender] Navigation committed away from scoped page, cleared scope:',
          {
            tabId: details.tabId,
            priorScope,
          }
        );
      }
    }
  });

  // Clean up cache when tabs are removed
  browser.tabs.onRemoved.addListener(tabId => {
    const tId = numberToTabId(tabId);

    // Clean up all tracking maps
    tabUrlMap.delete(tId);
    intentionScopePerTabId.delete(tId);
    lastRedirectAtByTabId.delete(tId);

    console.log('[Intender] Tab removed, cleared cache:', { tabId });
  });

  // Handle window focus changes
  browser.windows.onFocusChanged.addListener(async windowId => {
    // Update tracking: record previous focused window
    const prevWindowId = lastFocusedWindowId;
    if (windowId !== -1) {
      lastFocusedWindowId = numberToWindowId(windowId);
    }

    console.log('[Intender] Window focus changed:', {
      prevWindowId,
      newWindowId: windowId,
    });
    try {
      const mapSnapshot = Array.from(lastActiveTabIdByWindow.entries()).map(
        ([w, t]) => ({
          windowId: w as unknown as number,
          tabId: t as unknown as number,
        })
      );
      console.log(
        '[Intender] browser.windows.onFocusChanged - lastFocusedWindowId map snapshot',
        {
          lastFocusedWindowId,
          map: mapSnapshot,
        }
      );
    } catch {}

    // If windowId === -1 (no window focused), return early
    if (windowId === -1) return;

    // Skip if same window (duplicate focus event)
    const currentWindowId = numberToWindowId(windowId);
    if (prevWindowId && prevWindowId === currentWindowId) {
      console.log('[Intender] Duplicate window focus, skipping');
      return;
    }

    // Get the active tab in the newly focused window
    try {
      const [activeTab] = await browser.tabs.query({
        active: true,
        windowId: windowId,
      });

      if (!activeTab || typeof activeTab.id !== 'number') return;

      const activeTabId = numberToTabId(activeTab.id);

      // Compute fromTabId with fallback to query previous window
      const cachedFromTabId = prevWindowId
        ? lastActiveTabIdByWindow.get(prevWindowId)
        : undefined;

      // Check if cached tab has a scope
      const fromScope = cachedFromTabId
        ? getScopeForTab(cachedFromTabId)
        : null;

      // Determine if fallback is needed: no cached tab OR cached tab has no scope
      const willUseFallback = prevWindowId && (!cachedFromTabId || !fromScope);

      console.log('[Intender] Window focus fromTabId resolution:', {
        prevWindowId,
        cachedFromTabId,
        fromScope,
        willUseFallback,
      });

      let fromTabId = cachedFromTabId;

      // Fallback: if no cached fromTabId OR cached tab has no scope, query previous window
      if (willUseFallback) {
        try {
          // WindowId is just a branded number, cast it back to number for the query
          const prevWindowIdNumber = prevWindowId as unknown as number;
          console.log(
            '[Intender] Attempting fallback query for window:',
            prevWindowIdNumber
          );
          const [prevActiveTab] = await browser.tabs.query({
            active: true,
            windowId: prevWindowIdNumber,
          });
          if (prevActiveTab && typeof prevActiveTab.id === 'number') {
            const fallbackTabId = numberToTabId(prevActiveTab.id);
            const fallbackFromScope = getScopeForTab(
              fallbackTabId,
              prevActiveTab.url
            );

            if (fallbackFromScope) {
              // Bump the scope of the fallback-found tab
              updateIntentionScopeActivity(fallbackFromScope);

              // Update cache to keep it warm
              lastActiveTabIdByWindow.set(prevWindowId, fallbackTabId);

              console.log('[Intender] Fallback from-bump successful:', {
                fallbackTabId,
                fallbackFromScope,
                updatedCache: true,
              });

              // Use the fallback tab for further processing
              fromTabId = fallbackTabId;
            } else {
              console.log('[Intender] Fallback tab has no scope');
            }
          } else {
            console.log('[Intender] Fallback query found no active tab');
          }
        } catch (fallbackError) {
          console.log('[Intender] Fallback query failed:', fallbackError);
        }
      }

      // Use unified focus handler
      await handleFocusChange({
        fromTabId,
        toTabId: activeTabId,
        toUrl: activeTab.url,
        windowId: currentWindowId,
      });
    } catch (error) {
      console.log('[Intender] Failed to handle window focus change:', error);
    }
  });

  // Handle window removal cleanup
  browser.windows.onRemoved.addListener(windowId => {
    const wId = numberToWindowId(windowId);
    lastActiveTabIdByWindow.delete(wId);

    // If this was the last focused window, clear it
    if (lastFocusedWindowId === wId) {
      lastFocusedWindowId = null;
    }

    console.log('[Intender] Window removed, cleared tracking:', { windowId });
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
    }
  });

  async function inactivityChange(
    newState: chrome.idle.IdleState
  ): Promise<void> {
    if (newState === 'idle') {
      try {
        if (settingsCache.inactivityMode === 'off') return;

        // Strictly check for a currently focused window at idle time
        let focusedWindowId: number | null = null;
        try {
          const windows = await browser.windows.getAll();
          const focused = windows.find(w => w.focused);
          focusedWindowId = typeof focused?.id === 'number' ? focused.id : null;
        } catch (e) {
          // If we cannot determine a focused window, abort
          focusedWindowId = null;
        }

        if (focusedWindowId === null) {
          console.log(
            '[Intender] Inactivity: no focused window at idle, skipping'
          );
          return;
        }

        const [activeTab] = await browser.tabs.query({
          active: true,
          windowId: focusedWindowId,
        });
        if (!activeTab || typeof activeTab.id !== 'number') return;

        const tabId = numberToTabId(activeTab.id);
        const cachedUrl = tabUrlMap.get(tabId);
        const url =
          cachedUrl || (typeof activeTab.url === 'string' ? activeTab.url : '');
        if (!url) return;

        const intentionScopeId = getScopeForTab(tabId, url);
        if (!intentionScopeId) return;

        // Check audio exemption for all-except-audio mode
        if (settingsCache.inactivityMode === 'all-except-audio') {
          if (await isScopeAudible(intentionScopeId)) return;
        }

        // Redirect to intention page
        await redirectToIntentionPage(tabId, url, intentionScopeId);
      } catch (error) {
        console.log('[Intender] Inactivity check failed:', error);
      }
      return;
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
