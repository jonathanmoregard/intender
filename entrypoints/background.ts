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
import { normalizeUrl, parseUrlString } from '../components/normalized-url';
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

// Last-committed URL cache per tab (source of truth from onCommitted)
const committedTabUrlMap = new Map<TabId, string>();

// Inactivity tracking
const lastActiveByScope = new Map<IntentionScopeId, Timestamp>();
const intentionScopePerTabId = new Map<TabId, IntentionScopeId>();
const lastActiveTabIdByWindow = new Map<WindowId, TabId>();
// never -1, ignore non proper browser windows
let lastFocusedWindowId: WindowId | null = null;
const lastRedirectAtByTabId = new Map<TabId, Timestamp>();
// Separate per-tab decision debounce (distinct from redirect cooldown)
const lastDecisionAtByTabId = new Map<TabId, Timestamp>();

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
  let e2eDisableOsIdle = false; // Decoupled switch: disables OS idle listener only

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
    const cachedUrl = committedTabUrlMap.get(tabId);
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
    const resolvedUrl = toUrl || committedTabUrlMap.get(toTabId);
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
      const toUrl = committedTabUrlMap.get(toTabId);

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
      committedTabUrlMap.set(numberToTabId(tab.id), tab.url);
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
    committedTabUrlMap.set(tabId, details.url);

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

  // Handle same-document SPA route changes to keep scope in sync and enforce if needed
  browser.webNavigation.onHistoryStateUpdated.addListener(details => {
    if (details.frameId !== 0) return;
    const tabId = numberToTabId(details.tabId);
    // Decision debounce for SPA changes
    const now = createTimestamp();
    const lastDecisionAt = lastDecisionAtByTabId.get(tabId);
    const DECISION_DEBOUNCE_MS = 300;
    if (lastDecisionAt && now - lastDecisionAt < DECISION_DEBOUNCE_MS) {
      console.log(
        '[Intender] onHistoryStateUpdated: debounced per-tab decision'
      );
      return;
    }
    lastDecisionAtByTabId.set(tabId, now);

    committedTabUrlMap.set(tabId, details.url);

    const priorScope = intentionScopePerTabId.get(tabId) || null;
    const newScope = lookupIntentionScopeId(details.url);

    if (newScope) {
      intentionScopePerTabId.set(tabId, newScope);
      if (priorScope === null || priorScope !== newScope) {
        updateIntentionScopeActivity(newScope);
        // Enforce if SPA route change moved into a scoped URL
        // Skip if already on intention page
        if (!details.url.startsWith(intentionPageUrl)) {
          redirectToIntentionPage(tabId, details.url, newScope).catch(err =>
            console.log('[Intender] SPA enforcement redirect failed:', err)
          );
        }
      }
    } else if (priorScope) {
      intentionScopePerTabId.delete(tabId);
    }
  });

  // Clean up cache when tabs are removed
  browser.tabs.onRemoved.addListener(tabId => {
    const tId = numberToTabId(tabId);

    // Clean up all tracking maps
    committedTabUrlMap.delete(tId);
    intentionScopePerTabId.delete(tId);
    lastRedirectAtByTabId.delete(tId);
    lastDecisionAtByTabId.delete(tId);

    // Purge any window→tab pointers referencing this tab
    for (const [wId, cachedTabId] of lastActiveTabIdByWindow.entries()) {
      if (cachedTabId === tId) {
        lastActiveTabIdByWindow.delete(wId);
      }
    }

    console.log('[Intender] Tab removed, cleared cache:', { tabId });
  });

  // Handle tab replacement (e.g., prerender activation swaps tab IDs)
  browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    const added = numberToTabId(addedTabId);
    const removed = numberToTabId(removedTabId);

    // Move cached URL/state from removed → added when present
    const removedUrl = committedTabUrlMap.get(removed);
    if (removedUrl) {
      committedTabUrlMap.set(added, removedUrl);
      committedTabUrlMap.delete(removed);
    }

    const removedScope = intentionScopePerTabId.get(removed);
    if (removedScope) {
      intentionScopePerTabId.set(added, removedScope);
      intentionScopePerTabId.delete(removed);
    }

    lastRedirectAtByTabId.delete(removed);

    console.log('[Intender] Tab replaced:', {
      addedTabId,
      removedTabId,
      migratedUrl: removedUrl || null,
      migratedScope: removedScope || null,
    });
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

    // Use only cached per-window active tab snapshot; avoid live queries
    const currentWindowId = numberToWindowId(windowId);
    const toTabId = lastActiveTabIdByWindow.get(currentWindowId);
    const fromTabId = prevWindowId
      ? lastActiveTabIdByWindow.get(prevWindowId)
      : undefined;

    console.log('[Intender] Window focus change resolved from cache:', {
      currentWindowId,
      toTabId: toTabId || null,
      fromTabId: fromTabId || null,
    });

    if (!toTabId) return;

    await handleFocusChange({
      fromTabId,
      toTabId,
      windowId: currentWindowId,
    });
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
    const sourceUrl =
      committedTabUrlMap.get(numberToTabId(details.tabId)) || null; // last committed URL

    // Per-tab decision debounce to prevent multiple actions from one gesture
    const tabId = numberToTabId(details.tabId);
    const now = createTimestamp();
    const lastDecisionAt = lastDecisionAtByTabId.get(tabId);
    const DECISION_DEBOUNCE_MS = 300;
    if (lastDecisionAt && now - lastDecisionAt < DECISION_DEBOUNCE_MS) {
      console.log('[Intender] onBeforeNavigate: debounced per-tab decision');
      return;
    }
    lastDecisionAtByTabId.set(tabId, now);

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
      ? committedTabUrlMap.get(numberToTabId(activeTabId)) || null
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

    // Normalize for churn detection (ignore trivial same-to-same within short window)
    const parsedFrom = sourceUrl ? parseUrlString(sourceUrl) : null;
    const parsedTo = parseUrlString(targetUrl);
    const normalizedFrom = parsedFrom ? normalizeUrl(parsedFrom) : null;
    const normalizedTo = parsedTo ? normalizeUrl(parsedTo) : null;

    // Rule 1: If navigating within same intention scope, allow
    const sourceScope = sourceUrl ? lookupIntentionScopeId(sourceUrl) : null;
    const targetScope = lookupIntentionScopeId(targetUrl);
    if (sourceScope && targetScope && sourceScope === targetScope) {
      // Additionally, if URLs are identical (normalized), treat as churn and ignore
      if (normalizedFrom === normalizedTo) {
        console.log(
          '[Intender] Churn: same normalized URL within same scope, ignoring'
        );
        return;
      }
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
          'intention_completed'
        );

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

  // Idle-based inactivity for focused tab

  function updateIdleDetectionInterval(timeoutMs: TimeoutMs): void {
    const timeoutSeconds = Math.max(15, Math.floor(timeoutMs / 1000));
    try {
      const idleApi: any =
        (browser as any).idle ||
        (typeof chrome !== 'undefined' && (chrome as any).idle);
      if (idleApi && typeof idleApi.setDetectionInterval === 'function') {
        idleApi.setDetectionInterval(timeoutSeconds);
      } else {
        console.log('[Intender] Idle API not available: setDetectionInterval');
      }
    } catch (e) {
      console.log('[Intender] Failed to set idle detection interval:', e);
    }
  }

  function toggleIdleDetection(mode: InactivityMode): void {
    try {
      const idleApi: any =
        (browser as any).idle ||
        (typeof chrome !== 'undefined' && (chrome as any).idle);
      if (!idleApi || !idleApi.onStateChanged) {
        console.log('[Intender] Idle API not available: toggle');
        return;
      }
      if (mode === 'off' || e2eDisableIdleListener || e2eDisableOsIdle) {
        if (typeof idleApi.onStateChanged.removeListener === 'function') {
          idleApi.onStateChanged.removeListener(inactivityChange);
        }
      } else {
        if (typeof idleApi.onStateChanged.addListener === 'function') {
          idleApi.onStateChanged.addListener(inactivityChange);
        }
      }
    } catch (e) {
      console.log('[Intender] Failed to toggle idle listener:', e);
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
    } else if (msg.type === 'e2e:setOsIdle') {
      const m = message as { type: 'e2e:setOsIdle'; enabled?: boolean };
      const enabled = m.enabled === true;
      e2eDisableOsIdle = !enabled;
      console.log('[Intender] E2E setOsIdle =>', { enabled, e2eDisableOsIdle });
      toggleIdleDetection(settingsCache.inactivityMode);
    }
  });

  async function inactivityChange(newState: string): Promise<void> {
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
        const cachedUrl = committedTabUrlMap.get(tabId);
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

        // Refresh tab → scope mappings and bump activity for newly scoped tabs
        try {
          for (const [tabId, url] of committedTabUrlMap.entries()) {
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
