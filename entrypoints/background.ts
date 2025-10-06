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
import { storage, type InactivityMode } from '../components/storage';
import {
  createTimestamp,
  minutesToMs,
  type TimeoutMs,
  type Timestamp,
} from '../components/time';

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

// Cross-browser shim for storage.session (Firefox compatibility)
const sessionStore = chrome?.storage?.session ?? {
  async get() {
    return {};
  },
  async set() {
    /* no-op */
  },
  async remove() {
    /* no-op */
  },
};

// Update activity for an intention scope - moved inside defineBackground

// Utility helpers for session persistence
const mapToObject = <K extends string | number | symbol, V>(
  input: Map<K, V>
): Record<string, V> => {
  const out: Record<string, V> = {};
  for (const [key, value] of input) {
    out[String(key)] = value;
  }
  return out;
};

const objectToMap = <K extends string | number, V>(
  input?: Record<string, V>
): Map<K, V> => {
  const out = new Map<K, V>();
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    out.set(Number.isNaN(Number(key)) ? (key as K) : (Number(key) as K), value);
  }
  return out;
};

let persistSessionScheduled = false;
const persistSession = () => {
  if (persistSessionScheduled) return;
  persistSessionScheduled = true;
  queueMicrotask(() => {
    persistSessionScheduled = false;
    sessionStore
      .set({
        tabUrlMap: mapToObject(tabUrlMap),
        intentionScopePerTabId: mapToObject(intentionScopePerTabId),
        lastActiveByScope: mapToObject(lastActiveByScope),
        lastActiveTabIdByWindow: mapToObject(lastActiveTabIdByWindow),
        lastFocusedWindowId: lastFocusedWindowId
          ? (lastFocusedWindowId as unknown as number)
          : null,
      })
      .catch(error => {
        console.log('[Intender] Session persist failed:', error);
      });
  });
};

// Flush session on teardown to prevent data loss
chrome.runtime.onSuspend.addListener(() => {
  try {
    sessionStore.set({
      tabUrlMap: mapToObject(tabUrlMap),
      intentionScopePerTabId: mapToObject(intentionScopePerTabId),
      lastActiveByScope: mapToObject(lastActiveByScope),
      lastActiveTabIdByWindow: mapToObject(lastActiveTabIdByWindow),
      lastFocusedWindowId: lastFocusedWindowId
        ? (lastFocusedWindowId as unknown as number)
        : null,
    });
  } catch (e) {
    console.log('[Intender] onSuspend persist failed:', e);
  }
});

const hydrateSessionState = async () => {
  try {
    const sessionValues = await sessionStore.get([
      'tabUrlMap',
      'intentionScopePerTabId',
      'lastActiveByScope',
      'lastActiveTabIdByWindow',
      'lastFocusedWindowId',
    ]);

    const urlMap = objectToMap<number, string>(
      sessionValues.tabUrlMap as Record<string, string> | undefined
    );
    for (const [key, value] of urlMap) {
      tabUrlMap.set(numberToTabId(key), value);
    }

    const scopeMap = objectToMap<number, IntentionScopeId>(
      sessionValues.intentionScopePerTabId as
        | Record<string, IntentionScopeId>
        | undefined
    );
    for (const [key, value] of scopeMap) {
      intentionScopePerTabId.set(numberToTabId(key), value);
    }

    const activeScopeMap = objectToMap<string, Timestamp>(
      sessionValues.lastActiveByScope as Record<string, Timestamp> | undefined
    );
    for (const [key, value] of activeScopeMap) {
      lastActiveByScope.set(key as IntentionScopeId, value);
    }

    const activeTabMap = objectToMap<number, number>(
      sessionValues.lastActiveTabIdByWindow as
        | Record<string, number>
        | undefined
    );
    for (const [key, value] of activeTabMap) {
      lastActiveTabIdByWindow.set(numberToWindowId(key), numberToTabId(value));
    }

    lastFocusedWindowId =
      sessionValues.lastFocusedWindowId != null
        ? numberToWindowId(sessionValues.lastFocusedWindowId as number)
        : null;
  } catch (error) {
    console.log('[Intender] Failed hydration from storage.session:', error);
  }
};

const reconcileStateWithBrowser = async (
  intentionIndex: IntentionIndex,
  updateActivity?: (scopeId: IntentionScopeId) => void
) => {
  try {
    const allTabs = await browser.tabs.query({});
    const seenTabIds = new Set<TabId>();

    for (const tab of allTabs) {
      if (tab.id == null) continue;
      const tabId = numberToTabId(tab.id);
      seenTabIds.add(tabId);

      const url = typeof tab.url === 'string' ? tab.url : undefined;
      if (url) {
        tabUrlMap.set(tabId, url);
      }

      const matchedIntention = url
        ? lookupIntention(url, intentionIndex)
        : null;
      const scope = matchedIntention
        ? intentionToIntentionScopeId(matchedIntention)
        : null;
      if (scope) {
        intentionScopePerTabId.set(tabId, scope);
        if (!lastActiveByScope.has(scope) && updateActivity) {
          updateActivity(scope);
        }
      }

      if (tab.active && typeof tab.windowId === 'number') {
        lastActiveTabIdByWindow.set(numberToWindowId(tab.windowId), tabId);
      }
    }

    for (const tabId of Array.from(tabUrlMap.keys())) {
      if (!seenTabIds.has(tabId)) {
        tabUrlMap.delete(tabId);
        intentionScopePerTabId.delete(tabId);
      }
    }

    // Clean up stale window→tab mappings
    for (const [wId, tId] of lastActiveTabIdByWindow.entries()) {
      if (!seenTabIds.has(tId)) {
        lastActiveTabIdByWindow.delete(wId);
      }
    }

    try {
      const windows = await browser.windows.getAll();
      const focusedWindow = windows.find(w => w.focused);
      lastFocusedWindowId = focusedWindow?.id
        ? numberToWindowId(focusedWindow.id)
        : null;
    } catch (windowError) {
      lastFocusedWindowId = null;
      console.log('[Intender] Failed window reconciliation:', windowError);
    }

    persistSession();
  } catch (error) {
    console.log('[Intender] Failed reconciliation snapshot:', error);
  }
};

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export default defineBackground(async () => {
  console.log('[Intender] Background service worker started');

  // Cache data that won't change during session
  let intentionIndex: IntentionIndex = createIntentionIndex([]);
  const intentionPageUrl = browser.runtime.getURL('intention-page.html');
  // Settings variables
  let inactivityMode: InactivityMode = 'off';
  let inactivityTimeoutMs: TimeoutMs = minutesToMs(30) as TimeoutMs;

  // E2E: test control flag must be initialized before any calls that read it
  let e2eDisableOSIdle = false;

  // Cold window guard - prevents handlers from running with empty intentionIndex
  let intentionIndexReady = false;

  // Centralized readiness gate - ensures intentionIndex is ready before processing
  async function ensureReady(): Promise<void> {
    if (!intentionIndexReady) {
      console.log(
        '[Intender] Cold window: waiting for intentionIndex to be ready'
      );
      while (!intentionIndexReady) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      console.log(
        '[Intender] Cold window: intentionIndex is now ready, continuing'
      );
    }
  }

  // Initialize functions that will be used by listeners
  const updateIntentionScopeActivity = (intentionScopeId: IntentionScopeId) => {
    lastActiveByScope.set(intentionScopeId, createTimestamp());
    console.log(
      '[Intender] Updated activity for intention scope:',
      intentionScopeId
    );
    persistSession();
  };

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
          tab.mutedInfo?.muted !== true
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
    // Update tracking
    lastActiveTabIdByWindow.set(windowId, toTabId);
    persistSession();

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
    if (fromTabId && fromScope) updateIntentionScopeActivity(fromScope);

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
        inactivityMode,
        toScope,
        inactivityTimeoutMs
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

  function updateIdleDetectionInterval(timeoutMs: TimeoutMs): void {
    const timeoutSeconds = Math.max(15, Math.floor(timeoutMs / 1000));
    try {
      chrome.idle.setDetectionInterval(timeoutSeconds);
    } catch (e) {
      console.log('[Intender] Failed to set idle detection interval:', e);
    }
  }

  function toggleIdleDetection(mode: InactivityMode): void {
    if (mode === 'off' || e2eDisableOSIdle) {
      chrome.idle.onStateChanged.removeListener(inactivityChange);
    } else {
      chrome.idle.onStateChanged.addListener(inactivityChange);
    }
  }

  async function inactivityChange(
    newState: chrome.idle.IdleState
  ): Promise<void> {
    if (newState === 'idle') {
      try {
        if (inactivityMode === 'off') return;

        // Cold window guard - wait for intentionIndex to be ready
        await ensureReady();

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
        if (inactivityMode === 'all-except-audio') {
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

  // Register all listeners BEFORE any await calls (MV3 best practice)
  browser.tabs.onActivated.addListener(async activeInfo => {
    const windowId = numberToWindowId(activeInfo.windowId);
    const toTabId = numberToTabId(activeInfo.tabId);

    // Cold window guard - wait for intentionIndex to be ready
    await ensureReady();

    // Track previous active per window (from tab handling)
    const fromTabId = lastActiveTabIdByWindow.get(windowId);

    // Skip if same tab (spurious re-activation)
    if (fromTabId && fromTabId === toTabId) return;

    // Get the URL for the "to" tab
    const toUrl = tabUrlMap.get(toTabId);

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

    const intentionScopeId = getScopeForTab(tId);

    // Handle audible state changes - update activity when audio starts/stops
    if (changeInfo.audible !== undefined) {
      if (changeInfo.audible) {
        console.log('[Intender] Tab became audible, bumping activity:', {
          tabId,
          intentionScopeId: intentionScopeId || 'unknown',
        });
        if (intentionScopeId) updateIntentionScopeActivity(intentionScopeId);
      } else {
        console.log('[Intender] Tab stopped being audible, bumping activity:', {
          tabId,
          intentionScopeId: intentionScopeId || 'unknown',
        });
        if (intentionScopeId) updateIntentionScopeActivity(intentionScopeId);
      }
    }
  });

  // Track new tabs to initialize cache
  browser.tabs.onCreated.addListener(tab => {
    if (tab.id !== undefined && typeof tab.url === 'string') {
      tabUrlMap.set(numberToTabId(tab.id), tab.url);
      console.log('[Intender] Tab created, cached URL:', {
        tabId: tab.id,
        url: tab.url,
      });
      persistSession();
    }
  });

  // Update cache when navigation is committed (reliable source of truth)
  browser.webNavigation.onCommitted.addListener(async details => {
    // Only track main frame navigation
    if (details.frameId !== 0) {
      return;
    }

    // Cold window guard - wait for intentionIndex to be ready
    await ensureReady();

    const tabId = numberToTabId(details.tabId);
    const priorUrl = tabUrlMap.get(tabId) || null;
    tabUrlMap.set(tabId, details.url);
    persistSession();

    console.log('[Intender] Navigation committed, updated cache:', {
      tabId: details.tabId,
      url: details.url,
    });

    // If the destination URL matches an intention, record scope and possibly redirect.
    const matched = lookupIntention(details.url, intentionIndex);
    if (matched) {
      const scopeId = intentionToIntentionScopeId(matched);
      intentionScopePerTabId.set(tabId, scopeId);
      persistSession();

      // If we landed here via a server/client redirect (e.g., faceboo.com -> facebook.com),
      // enforce the intention gate even post-commit. Skip if coming from intention page
      // or if a recent redirect happened to avoid loops.
      const cameFromIntentionPage =
        priorUrl?.startsWith(intentionPageUrl) === true;
      if (!cameFromIntentionPage) {
        try {
          await redirectToIntentionPage(tabId, details.url, scopeId);
          // redirectToIntentionPage handles cooldown and logging
          return;
        } catch (e) {
          // If redirect fails, fall through to activity bump
          console.log('[Intender] Post-commit redirect attempt failed:', e);
        }
      }

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
        persistSession();
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
    persistSession();

    console.log('[Intender] Tab removed, cleared cache:', { tabId });
  });

  // Handle tab replacement (e.g., prerender activation swaps tab IDs)
  browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    const added = numberToTabId(addedTabId);
    const removed = numberToTabId(removedTabId);

    // Move cached URL/state from removed → added when present
    const removedUrl = tabUrlMap.get(removed);
    if (removedUrl) {
      tabUrlMap.set(added, removedUrl);
      tabUrlMap.delete(removed);
    }

    const removedScope = intentionScopePerTabId.get(removed);
    if (removedScope) {
      intentionScopePerTabId.set(added, removedScope);
      intentionScopePerTabId.delete(removed);
    }

    lastRedirectAtByTabId.delete(removed);
    persistSession();

    console.log('[Intender] Tab replaced:', {
      addedTabId,
      removedTabId,
      migratedUrl: removedUrl || null,
      migratedScope: removedScope || null,
    });
  });

  // Handle window focus changes
  browser.windows.onFocusChanged.addListener(async windowId => {
    // Cold window guard - wait for intentionIndex to be ready
    await ensureReady();
    // Update tracking: record previous focused window
    const prevWindowId = lastFocusedWindowId;
    if (windowId !== -1) {
      lastFocusedWindowId = numberToWindowId(windowId);
      persistSession();
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

    // Do not skip duplicate window focus events. We still resolve the active
    // tab and run focus handling to guarantee inactivity checks run reliably
    // across window switches (prevents missed checks in certain sequences).
    const currentWindowId = numberToWindowId(windowId);

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

    persistSession();

    console.log('[Intender] Window removed, cleared tracking:', { windowId });
  });

  browser.webNavigation.onBeforeNavigate.addListener(async details => {
    if (details.frameId !== 0) return;

    // Cold window guard - wait for intentionIndex to be ready
    await ensureReady();

    const targetUrl = details.url;
    const sourceUrl = tabUrlMap.get(numberToTabId(details.tabId)) || null; // last committed URL

    // Determine active tab snapshot without querying (race-safe)
    const navigationTabId = details.tabId;
    const focusedWindowId = lastFocusedWindowId;
    const activeTabId = focusedWindowId
      ? (lastActiveTabIdByWindow.get(focusedWindowId) as unknown as
          | number
          | undefined)
      : undefined;
    const isNavigationTabActive =
      activeTabId === navigationTabId && focusedWindowId != null;
    const activeTabUrl = activeTabId
      ? tabUrlMap.get(numberToTabId(activeTabId)) || null
      : null;

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

    // Rule 1: If navigating within same intention scope, allow
    const sourceScope = sourceUrl ? lookupIntentionScopeId(sourceUrl) : null;
    const targetScope = lookupIntentionScopeId(targetUrl);
    if (sourceScope && targetScope && sourceScope === targetScope) {
      console.log(
        '[Intender] Rule 1: Same intention scope navigation, allowing'
      );
      return;
    }

    // Rule 2: If redirect is initiated from intention page, allow
    if (sourceUrl && sourceUrl.startsWith(intentionPageUrl)) {
      try {
        const targetUrlObj = new URL(targetUrl);
        const intentionCompleted = targetUrlObj.searchParams.get(
          'intention_completed_53c5890'
        );
        const queryParams: Record<string, string> = {};
        try {
          targetUrlObj.searchParams.forEach((value, key) => {
            queryParams[key] = value;
          });
        } catch {}
        console.log('[Intender] Rule2 target inspect', {
          targetUrl,
          queryParams,
          intentionCompleted,
        });

        if (intentionCompleted === 'true') {
          console.log(
            '[Intender] Rule 2: Origin intention page with completion flag, allowing (initiated from intention page)'
          );
          return;
        } else {
          console.log(
            '[Intender] Rule 2b: Origin intention page without completion flag, disallowing (race condition)'
          );
          // Keep user on the intention page by setting it again (no-op visually)
          try {
            await browser.tabs.update(details.tabId, { url: sourceUrl });
          } catch (error) {
            console.log(
              '[Intender] Rule 2b update failed (tab may be closed):',
              error
            );
          }
          return;
        }
      } catch (error) {
        console.log(
          '[Intender] Rule 2: Failed to parse target URL, allowing:',
          error
        );
        return;
      }
    }

    // Rule 3: If active tab is on same intention scope as target (and not same tab), allow
    // This handles cases like:
    // - Opening new tab from scoped site (active tab is scoped) → navigating to same scope
    // - Duplicating scoped tab (active tab is scoped) → navigating within same scope
    // - Middle-click link from scoped site (active tab is scoped) → opening same scope link
    // The !== check is to avoid allowing everything. Without it,
    // navigation that is happening in the active tab would always pass

    const activeTabScope = activeTabUrl
      ? lookupIntentionScopeId(activeTabUrl)
      : null;
    if (
      !isNavigationTabActive &&
      activeTabScope &&
      activeTabScope === targetScope
    ) {
      console.log(
        '[Intender] Rule 3: Active tab on same intention scope, allowing'
      );
      return;
    }

    // Rule 4: Otherwise, check if we need to block using new matching system
    const targetIntention = lookupIntention(targetUrl, intentionIndex);

    if (targetIntention) {
      console.log(
        '[Intender] Rule 4: Blocking navigation, showing intention page for:',
        targetIntention
      );

      // Track the intention scope for this tab
      const targetIntentionScopeId =
        intentionToIntentionScopeId(targetIntention);
      intentionScopePerTabId.set(
        numberToTabId(details.tabId),
        targetIntentionScopeId
      );
      persistSession();

      const redirectUrl = browser.runtime.getURL(
        'intention-page.html?target=' +
          encodeURIComponent(targetUrl) +
          '&intentionScopeId=' +
          encodeURIComponent(targetIntention.id)
      );

      try {
        await browser.tabs.update(details.tabId, { url: redirectUrl });
      } catch (error) {
        // Tab might be gone, ignore the error
        console.log('[Intender] Tab update failed, tab may be closed:', error);
      }
    }
  });

  // E2E only: force the same logic as idle without relying on OS idle in automation.
  // Rationale: In MV3 tests, timers can be suspended and OS idle often doesn't flip.
  // This hook lets tests trigger the same per-scope path from an extension page.
  browser.runtime.onMessage.addListener(async (message: unknown) => {
    const msg = message as { type?: string } | null | undefined;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'e2e:forceInactivityCheck-idle') {
      e2eDisableOSIdle = true;
      toggleIdleDetection(inactivityMode);
      await inactivityChange('idle');
    } else if (msg.type === 'e2e:setOsIdle') {
      const m = message as { type: 'e2e:setOsIdle'; enabled?: boolean };
      const enabled = m.enabled === true;
      e2eDisableOSIdle = !enabled;
      console.log('[Intender] E2E setOsIdle =>', { enabled, e2eDisableOSIdle });
      toggleIdleDetection(inactivityMode);
    }
  });

  // Refresh cached intentions and inactivity settings when storage changes
  browser.storage.onChanged.addListener(async changes => {
    try {
      // Intentions updated → rebuild index
      if (changes.intentions) {
        const { intentions } = await storage.get();
        const parsedIntentions = mapNulls(parseIntention, intentions);
        intentionIndex = createIntentionIndex(parsedIntentions);

        // Refresh tab → scope mappings and bump activity for newly scoped tabs
        try {
          for (const [tabId, url] of tabUrlMap.entries()) {
            const priorScope = intentionScopePerTabId.get(tabId) || null;
            const newScope = lookupIntentionScopeId(url);
            if (newScope) {
              intentionScopePerTabId.set(tabId, newScope);
              if (priorScope === null || priorScope !== newScope) {
                updateIntentionScopeActivity(newScope);
                console.log(
                  '[Intender] Intentions changed: mapped tab to scope and updated activity',
                  {
                    tabId: tabId as unknown as number,
                    url,
                    newScope,
                    priorScope: priorScope || null,
                  }
                );
              }
            } else if (priorScope) {
              intentionScopePerTabId.delete(tabId);
              console.log(
                '[Intender] Intentions changed: cleared scope mapping for tab',
                {
                  tabId: tabId as unknown as number,
                  url,
                  priorScope,
                }
              );
            }
          }
        } catch (e) {
          console.log(
            '[Intender] Failed to refresh mappings after intentions change:',
            e
          );
        }
      }

      // Inactivity settings updated → refresh snapshot and idle interval
      if (changes.inactivityMode || changes.inactivityTimeoutMs) {
        const {
          inactivityMode: newInactivityMode,
          inactivityTimeoutMs: newInactivityTimeoutMs,
        } = await storage.get();
        inactivityMode = (newInactivityMode ??
          inactivityMode) as InactivityMode;
        inactivityTimeoutMs = (newInactivityTimeoutMs ??
          inactivityTimeoutMs) as TimeoutMs;
        updateIdleDetectionInterval(inactivityTimeoutMs);
        toggleIdleDetection(inactivityMode);
      }
    } catch (error) {
      console.error('[Intender] Failed handling storage change:', error);
    }
  });

  // NOW start the async initialization after all listeners are registered
  await hydrateSessionState();

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
          persistSession();
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
      inactivityMode: storedInactivityMode = 'off',
      inactivityTimeoutMs: storedInactivityTimeoutMs = minutesToMs(30),
    } = await storage.get();
    const parsedIntentions = mapNulls(parseIntention, intentions);
    intentionIndex = createIntentionIndex(parsedIntentions);
    intentionIndexReady = true;

    inactivityMode = storedInactivityMode as InactivityMode;
    inactivityTimeoutMs = storedInactivityTimeoutMs as TimeoutMs;
    updateIdleDetectionInterval(inactivityTimeoutMs);
    toggleIdleDetection(inactivityMode);

    // Now reconcile using a ready intentionIndex
    await reconcileStateWithBrowser(
      intentionIndex,
      updateIntentionScopeActivity
    );
  } catch (error) {
    console.error('[Intender] Failed to load intentions on startup:', error);
  }
});
