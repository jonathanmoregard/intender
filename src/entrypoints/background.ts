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
import { debugLog, setDebugLogging } from '../components/debugLogging';
import { storage, type InactivityMode } from '../components/storage';
import {
  createTimestamp,
  minutesToMs,
  type TimeoutMs,
  type Timestamp,
} from '../components/time';

// Branded type for tab ID
export type TabId = Brand<number, 'TabId'>;

function numberToTabId(num: number): TabId {
  return num as TabId;
}

function tabIdToNumber(id: TabId): number {
  return id as unknown as number;
}

// Branded type for window ID
export type WindowId = Brand<number, 'WindowId'>;

function numberToWindowId(num: number): WindowId {
  return num as WindowId;
}

function windowIdToNumber(id: WindowId): number {
  return id as unknown as number;
}

const buildIntentionRedirectUrl = (
  targetUrl: string,
  scopeId: IntentionScopeId
): string =>
  browser.runtime.getURL(
    `intention-page.html?target=${encodeURIComponent(targetUrl)}&intentionScopeId=${encodeURIComponent(scopeId)}`
  );

// Tab URL cache to track last-known URLs for each tab
const tabUrlMap = new Map<TabId, string>();
const audibleTabIds = new Set<TabId>();

const isTabAudible = (tab: Pick<browser.Tabs.Tab, 'audible' | 'mutedInfo'>) =>
  tab.audible === true && tab.mutedInfo?.muted !== true;

const trackTabAudibility = (tab: browser.Tabs.Tab) => {
  if (tab.id == null) return;
  const tabId = numberToTabId(tab.id);
  if (isTabAudible(tab)) audibleTabIds.add(tabId);
  else audibleTabIds.delete(tabId);
};

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
          ? windowIdToNumber(lastFocusedWindowId)
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
    // Clean orphaned scopes before persisting
    const activeScopes = new Set(intentionScopePerTabId.values());
    for (const scope of lastActiveByScope.keys()) {
      if (!activeScopes.has(scope)) {
        lastActiveByScope.delete(scope);
      }
    }
    sessionStore.set({
      tabUrlMap: mapToObject(tabUrlMap),
      intentionScopePerTabId: mapToObject(intentionScopePerTabId),
      lastActiveByScope: mapToObject(lastActiveByScope),
      lastActiveTabIdByWindow: mapToObject(lastActiveTabIdByWindow),
      lastFocusedWindowId: lastFocusedWindowId
        ? windowIdToNumber(lastFocusedWindowId)
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

/**
 * The window Chrome reports as focused right now, or null when Chrome itself
 * is in the background. Ask this before concluding that the user is away:
 * `lastFocusedWindowId` is only as current as the last focus event, and a
 * worker that restarted while Chrome was in the background never heard the
 * focus come back.
 */
const readFocusedWindowId = async (): Promise<WindowId | null> => {
  try {
    const windows = await browser.windows.getAll();
    const focusedWindow = windows.find(w => w.focused);
    return focusedWindow?.id ? numberToWindowId(focusedWindow.id) : null;
  } catch (windowError) {
    console.log('[Intender] Failed to read focused window:', windowError);
    return null;
  }
};

/**
 * Which window the user was last in, as far as the browser will say.
 *
 * Used where a missing answer would be read as "the user is nowhere": on a
 * cold start, no window is reported focused while Chrome is in the background,
 * and a worker that believed that would treat every later tab switch as
 * bookkeeping. The last focused window is still the one they were in; an
 * actual loss of focus is reported separately, as onFocusChanged(-1).
 */
const resolveFocusedWindowId = async (): Promise<WindowId | null> => {
  const focused = await readFocusedWindowId();
  if (focused) return focused;
  try {
    const lastFocused = await browser.windows.getLastFocused();
    return lastFocused?.id ? numberToWindowId(lastFocused.id) : null;
  } catch (windowError) {
    console.log('[Intender] Failed to resolve focused window:', windowError);
    return null;
  }
};

const reconcileStateWithBrowser = async (
  intentionIndex: IntentionIndex,
  updateActivity?: (scopeId: IntentionScopeId) => void
) => {
  try {
    const allTabs = await browser.tabs.query({});
    const seenTabIds = new Set<TabId>();
    audibleTabIds.clear();

    for (const tab of allTabs) {
      if (tab.id == null) continue;
      const tabId = numberToTabId(tab.id);
      seenTabIds.add(tabId);
      trackTabAudibility(tab);

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
      } else {
        intentionScopePerTabId.delete(tabId);
      }

      // Seed only what the session did not already carry. The browser's view
      // is "which tab is active now", which on a restart is the tab whose
      // activation woke the worker - overwriting with it would make that tab
      // its own predecessor and silence the check it just asked for.
      if (tab.active && typeof tab.windowId === 'number') {
        const windowId = numberToWindowId(tab.windowId);
        if (!lastActiveTabIdByWindow.has(windowId)) {
          lastActiveTabIdByWindow.set(windowId, tabId);
        }
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

    const resolvedWindowId = await resolveFocusedWindowId();
    if (resolvedWindowId) lastFocusedWindowId = resolvedWindowId;

    persistSession();
  } catch (error) {
    console.log('[Intender] Failed reconciliation snapshot:', error);
  }
};

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export default defineBackground(async () => {
  // Settings variables
  let inactivityMode: InactivityMode = 'off';
  let inactivityTimeoutMs: TimeoutMs = minutesToMs(30) as TimeoutMs;

  console.log('[Intender] Background service worker started');

  // Cache data that won't change during session
  let intentionIndex: IntentionIndex = createIntentionIndex([]);
  const intentionPageUrl = browser.runtime.getURL('intention-page.html');

  // E2E: test control flag must be initialized before any calls that read it
  let e2eDisableOSIdle = false;

  // Cold window guard - prevents handlers from running with empty intentionIndex
  let intentionIndexReady = false;

  // Centralized readiness gate - ensures intentionIndex is ready before processing
  async function ensureReady(): Promise<void> {
    if (intentionIndexReady) return;
    const MAX_WAIT_MS = 5000;
    const start = Date.now();
    debugLog('[Intender] Cold window: waiting for intentionIndex to be ready');
    while (!intentionIndexReady) {
      if (Date.now() - start > MAX_WAIT_MS) {
        console.error(
          '[Intender] Timeout waiting for intentionIndex - proceeding anyway'
        );
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    debugLog('[Intender] Cold window: intentionIndex is now ready, continuing');
  }

  // Initialize functions that will be used by listeners
  const updateIntentionScopeActivity = (intentionScopeId: IntentionScopeId) => {
    lastActiveByScope.set(intentionScopeId, createTimestamp());
    debugLog(
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

  // The same policy applies to full-document and same-document navigation.
  type NavigationDecision =
    | {
        kind: 'allow';
        reason:
          | 'same-scope'
          | 'intention-completed'
          | 'active-tab-same-scope'
          | 'no-match';
      }
    | { kind: 'block_redirect'; reason: 'matched-scope'; redirectTo: string };

  // A decision belongs to one navigation, never to a reusable tab/URL pair.
  // Keep its source until commit so server redirects are checked from the page
  // that initiated the navigation. A newer before-event supersedes this entry.
  const pendingNavigations = new Map<
    number,
    {
      sourceUrl: string | null;
      targetUrl: string;
      decision: NavigationDecision;
    }
  >();

  function getActiveTabSnapshot(navigationTabId: number): {
    isNavigationTabActive: boolean;
    activeTabUrl: string | null;
  } {
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
    return { isNavigationTabActive, activeTabUrl };
  }

  function decideNavigation(args: {
    tabId: number;
    sourceUrl: string | null;
    targetUrl: string;
    cameFromIntentionPage?: boolean;
  }): NavigationDecision {
    const { tabId, sourceUrl, targetUrl, cameFromIntentionPage } = args;
    const { isNavigationTabActive, activeTabUrl } = getActiveTabSnapshot(tabId);

    // Same-scope allow
    const sourceScope = sourceUrl ? lookupIntentionScopeId(sourceUrl) : null;
    const targetScope = lookupIntentionScopeId(targetUrl);
    if (sourceScope && targetScope && sourceScope === targetScope) {
      return { kind: 'allow', reason: 'same-scope' };
    }

    // Intention completion allow (explicit token)
    try {
      const tu = new URL(targetUrl);
      if (
        tu.searchParams.get('intention_completed_53c5890') === 'true' &&
        cameFromIntentionPage
      ) {
        return { kind: 'allow', reason: 'intention-completed' };
      }
    } catch (error) {
      debugLog(
        '[Intender] Failed to parse target URL for intention completion token:',
        error
      );
    }

    // Active tab same-scope (background new tab open, also covers server redirects)
    const activeScope = activeTabUrl
      ? lookupIntentionScopeId(activeTabUrl)
      : null;
    if (
      targetScope &&
      activeScope &&
      activeScope === targetScope &&
      isNavigationTabActive === false
    ) {
      return { kind: 'allow', reason: 'active-tab-same-scope' };
    }

    if (targetScope) {
      return {
        kind: 'block_redirect',
        reason: 'matched-scope',
        redirectTo: buildIntentionRedirectUrl(targetUrl, targetScope),
      };
    }

    return { kind: 'allow', reason: 'no-match' };
  }

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
          isTabAudible(tab)
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
      debugLog('[Intender] getScopeForTab: mapped scope', {
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
      debugLog('[Intender] getScopeForTab: from URL', {
        tabId,
        url: resolvedUrl,
        scopeFromUrl: scopeFromUrl || null,
      });
      return scopeFromUrl;
    }

    // 3. otherwise return null
    debugLog('[Intender] getScopeForTab: unresolved', { tabId });
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

    debugLog('[Intender] Inactivity check:', {
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
      debugLog('[Intender] Redirect cooldown active, skipping:', {
        tabId,
        lastRedirect,
        now,
        cooldownMs: REDIRECT_COOLDOWN_MS,
      });
      return false;
    }

    const redirectUrl = buildIntentionRedirectUrl(targetUrl, toScope);

    try {
      await browser.tabs.update(tabId, { url: redirectUrl });
      lastRedirectAtByTabId.set(tabId, now);
      debugLog('[Intender] Redirected to intention page:', {
        tabId,
        targetUrl,
        toScope,
      });
      return true;
    } catch (error) {
      debugLog('[Intender] Failed to redirect to intention page:', error);
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

    debugLog('[Intender] Focus change:', {
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
      debugLog('[Intender] Same-scope switch detected, fast path:', {
        scope: toScope,
        fromScope,
        toScope,
        scopesEqual: fromScope === toScope,
      });
      // Bump activity for the scope and update tracking
      updateIntentionScopeActivity(toScope);
      return;
    }

    // From bump: update activity for the previous tab's scope
    if (fromTabId && fromScope) updateIntentionScopeActivity(fromScope);

    // Guard: if the target tab URL is already the intention page URL, skip redirect
    const resolvedUrl = toUrl || tabUrlMap.get(toTabId);
    if (resolvedUrl && resolvedUrl.startsWith(intentionPageUrl)) {
      debugLog(
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
      debugLog('[Intender] Triggering inactivity redirect for scope:', toScope);

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
      debugLog('[Intender] Failed to set idle detection interval:', e);
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
        // Cold window guard - wait for settings and intentionIndex to be ready.
        // A restarted worker still holds the default mode, and reading it first
        // would silently skip the check that woke the worker.
        await ensureReady();

        if (inactivityMode === 'off') return;

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
          debugLog(
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
        debugLog('[Intender] Inactivity check failed:', error);
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

    // Track previous active per window (from tab handling). Safe to read after
    // the gate: reconciliation only fills gaps, so a restarted worker still
    // sees the tab the session recorded rather than this activation's own tab.
    const fromTabId = lastActiveTabIdByWindow.get(windowId);

    // Refresh from the browser before judging: a focus event that arrived
    // while the worker was dead is simply never delivered, and the stale null
    // it leaves behind would dismiss every later switch as bookkeeping.
    const focusedNow = await readFocusedWindowId();
    if (focusedNow) lastFocusedWindowId = focusedNow;

    // Activation in an unfocused window is bookkeeping, not user activity.
    if (lastFocusedWindowId !== windowId) {
      lastActiveTabIdByWindow.set(windowId, toTabId);
      persistSession();
      return;
    }

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
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const tId = numberToTabId(tabId);
    const intentionScopeId = getScopeForTab(tId);
    const audioChanged =
      changeInfo.audible !== undefined || changeInfo.mutedInfo !== undefined;
    if (!audioChanged) return;

    // Track effective playback, not the presence of an update field: mutedInfo
    // also contains metadata that can change without changing audibility.
    const wasAudible = audibleTabIds.has(tId);
    trackTabAudibility(tab);
    if (!intentionScopeId) return;
    if (
      getActiveTabSnapshot(tabId).isNavigationTabActive ||
      (inactivityMode === 'all-except-audio' &&
        wasAudible !== isTabAudible(tab))
    ) {
      updateIntentionScopeActivity(intentionScopeId);
    }
  });

  // Track new tabs to initialize cache
  browser.tabs.onCreated.addListener(tab => {
    trackTabAudibility(tab);
    if (tab.id !== undefined && typeof tab.url === 'string') {
      tabUrlMap.set(numberToTabId(tab.id), tab.url);
      debugLog('[Intender] Tab created, cached URL:', {
        tabId: tab.id,
        url: tab.url,
      });
      persistSession();
    }
  });

  // Update cache when navigation is committed (reliable source of truth)
  async function handleCommittedNavigation(
    details: { tabId: number; frameId: number; url: string },
    sameDocument = false
  ): Promise<void> {
    // Only track main frame navigation
    if (details.frameId !== 0) {
      return;
    }

    // Cold window guard - wait for intentionIndex to be ready
    await ensureReady();

    const tabId = numberToTabId(details.tabId);
    const pending = sameDocument
      ? undefined
      : pendingNavigations.get(details.tabId);
    pendingNavigations.delete(details.tabId);
    const priorUrl = pending
      ? pending.sourceUrl
      : (tabUrlMap.get(tabId) ?? null);

    debugLog('[Intender] Navigation committed, updated cache:', {
      tabId: details.tabId,
      url: details.url,
    });

    // Unified decision (post-commit)
    const cameFromIntentionPage =
      priorUrl?.startsWith(intentionPageUrl) === true;
    // Completion may redirect within its authorized scope (e.g. stripping the
    // token). It does not authorize a different intention's destination.
    const completedScope =
      pending?.decision.kind === 'allow' &&
      pending.decision.reason === 'intention-completed'
        ? lookupIntentionScopeId(pending.targetUrl)
        : null;
    const reusePending =
      pending &&
      (pending.targetUrl === details.url ||
        (completedScope !== null &&
          completedScope === lookupIntentionScopeId(details.url)));
    const decision =
      (reusePending ? pending.decision : null) ??
      decideNavigation({
        tabId: details.tabId,
        sourceUrl: priorUrl,
        targetUrl: details.url,
        cameFromIntentionPage,
      });
    tabUrlMap.set(tabId, details.url);
    persistSession();

    if (decision.kind === 'block_redirect') {
      try {
        await browser.tabs.update(details.tabId, { url: decision.redirectTo });
        return;
      } catch (e) {
        debugLog('[Intender] Post-commit redirect failed, closing tab:', e);
        try {
          await browser.tabs.remove(details.tabId);
          return;
        } catch {
          debugLog('[Intender] Tab removal also failed (tab likely gone)');
          return;
        }
      }
    }

    // Align scope mapping
    const matched = lookupIntention(details.url, intentionIndex);
    if (matched) {
      const scopeId = intentionToIntentionScopeId(matched);
      intentionScopePerTabId.set(tabId, scopeId);
      persistSession();
      // A page can reload or update history on a timer. Only navigation in the
      // foreground tab is evidence of user activity; audio has its own handler.
      if (getActiveTabSnapshot(details.tabId).isNavigationTabActive) {
        updateIntentionScopeActivity(scopeId);
      }
      debugLog('[Intender] Navigation committed to scoped page, set scope:', {
        tabId: details.tabId,
        scopeId,
      });
    } else {
      const priorScope = intentionScopePerTabId.get(tabId);
      if (priorScope) {
        intentionScopePerTabId.delete(tabId);
        debugLog(
          '[Intender] Navigation committed away from scoped page, cleared scope:',
          {
            tabId: details.tabId,
            priorScope,
          }
        );
        persistSession();
      }
    }
  }

  browser.webNavigation.onCommitted.addListener(details =>
    handleCommittedNavigation(details)
  );
  browser.webNavigation.onHistoryStateUpdated.addListener(details =>
    handleCommittedNavigation(details, true)
  );
  browser.webNavigation.onReferenceFragmentUpdated.addListener(details =>
    handleCommittedNavigation(details, true)
  );

  // Clean up cache when tabs are removed
  browser.tabs.onRemoved.addListener(tabId => {
    const tId = numberToTabId(tabId);

    // Clean up all tracking maps
    tabUrlMap.delete(tId);
    audibleTabIds.delete(tId);
    intentionScopePerTabId.delete(tId);
    lastRedirectAtByTabId.delete(tId);
    pendingNavigations.delete(tabId);
    for (const [windowId, activeTabId] of lastActiveTabIdByWindow) {
      if (activeTabId === tId) lastActiveTabIdByWindow.delete(windowId);
    }
    persistSession();

    debugLog('[Intender] Tab removed, cleared cache:', { tabId });
  });

  // Handle tab replacement (e.g., prerender activation swaps tab IDs)
  browser.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
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
    audibleTabIds.delete(removed);
    pendingNavigations.delete(removedTabId);
    pendingNavigations.delete(addedTabId);
    for (const [windowId, activeTabId] of lastActiveTabIdByWindow) {
      if (activeTabId === removed) lastActiveTabIdByWindow.set(windowId, added);
    }
    persistSession();

    debugLog('[Intender] Tab replaced:', {
      addedTabId,
      removedTabId,
      migratedUrl: removedUrl || null,
      migratedScope: removedScope || null,
    });
    try {
      trackTabAudibility(await browser.tabs.get(addedTabId));
    } catch {
      // A replacement may itself close before its snapshot can be read.
      audibleTabIds.delete(added);
    }
  });

  // Handle window focus changes
  browser.windows.onFocusChanged.addListener(async windowId => {
    // Cold window guard - wait for intentionIndex to be ready
    await ensureReady();
    // Update tracking: record previous focused window
    const prevWindowId = lastFocusedWindowId;
    lastFocusedWindowId = windowId === -1 ? null : numberToWindowId(windowId);
    if (windowId === -1 && prevWindowId !== null) {
      const departingTab = lastActiveTabIdByWindow.get(prevWindowId);
      const departingScope = departingTab ? getScopeForTab(departingTab) : null;
      if (departingScope) updateIntentionScopeActivity(departingScope);
    }
    persistSession();

    debugLog('[Intender] Window focus changed:', {
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
      debugLog(
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

      debugLog('[Intender] Window focus fromTabId resolution:', {
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
          const prevWindowIdNumber = windowIdToNumber(prevWindowId);
          debugLog(
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

              debugLog('[Intender] Fallback from-bump successful:', {
                fallbackTabId,
                fallbackFromScope,
                updatedCache: true,
              });

              // Use the fallback tab for further processing
              fromTabId = fallbackTabId;
            } else {
              debugLog('[Intender] Fallback tab has no scope');
            }
          } else {
            debugLog('[Intender] Fallback query found no active tab');
          }
        } catch (fallbackError) {
          debugLog('[Intender] Fallback query failed:', fallbackError);
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
      debugLog('[Intender] Failed to handle window focus change:', error);
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

    debugLog('[Intender] Window removed, cleared tracking:', { windowId });
  });

  browser.webNavigation.onBeforeNavigate.addListener(async details => {
    if (details.frameId !== 0) return;

    // Cold window guard - wait for intentionIndex to be ready
    await ensureReady();

    const targetUrl = details.url;
    const sourceUrl = tabUrlMap.get(numberToTabId(details.tabId)) || null; // last committed URL

    // Development logging
    debugLog('[Intender] Navigation check:', {
      targetUrl,
      sourceUrl: sourceUrl || 'null',
      tabId: details.tabId,
      frameId: details.frameId,
    });

    // Unified decision path
    {
      const decision = decideNavigation({
        tabId: details.tabId,
        sourceUrl,
        targetUrl,
        cameFromIntentionPage: sourceUrl?.startsWith(intentionPageUrl) === true,
      });
      pendingNavigations.set(details.tabId, { sourceUrl, targetUrl, decision });

      if (decision.kind === 'allow') return;

      // Track scope and redirect
      const matched = lookupIntention(targetUrl, intentionIndex);
      if (!matched) {
        debugLog(
          '[Intender] Race: intention removed between decision and redirect'
        );
        return;
      }
      const targetIntentionScopeId = intentionToIntentionScopeId(matched);
      try {
        await browser.tabs.update(details.tabId, { url: decision.redirectTo });
        intentionScopePerTabId.set(
          numberToTabId(details.tabId),
          targetIntentionScopeId
        );
        persistSession();
      } catch (error) {
        debugLog('[Intender] Pre-commit redirect failed, closing tab:', error);
        try {
          await browser.tabs.remove(details.tabId);
        } catch {
          debugLog('[Intender] Tab removal also failed (tab likely gone)');
        }
      }
      return;
    }
  });

  // E2E only: force the same logic as idle without relying on OS idle in automation.
  // Rationale: In MV3 tests, timers can be suspended and OS idle often doesn't flip.
  // This hook lets tests trigger the same per-scope path from an extension page.
  browser.runtime.onMessage.addListener(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - webextension-polyfill types are too strict; returning true|void is valid
    async (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: unknown) => void
    ) => {
      const msg = message as { type?: string } | null | undefined;
      if (!msg || typeof msg.type !== 'string') return;

      // Both branches read the stored mode, which a restarted worker has not
      // loaded yet.
      await ensureReady();

      if (msg.type === 'e2e:forceInactivityCheck-idle') {
        e2eDisableOSIdle = true;
        toggleIdleDetection(inactivityMode);
        await inactivityChange('idle');
        return;
      } else if (msg.type === 'e2e:setOsIdle') {
        const m = message as { type: 'e2e:setOsIdle'; enabled?: boolean };
        const enabled = m.enabled === true;
        e2eDisableOSIdle = !enabled;
        debugLog('[Intender] E2E setOsIdle =>', { enabled, e2eDisableOSIdle });
        toggleIdleDetection(inactivityMode);
        return;
      }
    }
  ) as unknown as Parameters<typeof browser.runtime.onMessage.addListener>[0];

  // Refresh cached intentions and inactivity settings when storage changes
  browser.storage.onChanged.addListener(async changes => {
    try {
      // Intentions updated → rebuild index
      if (changes.intentions) {
        const { intentions } = await storage.get();
        const parsedIntentions = mapNulls(parseIntention, intentions);
        intentionIndex = createIntentionIndex(parsedIntentions);
        pendingNavigations.clear();

        // Refresh tab → scope mappings and bump activity for newly scoped tabs
        try {
          for (const [tabId, url] of tabUrlMap.entries()) {
            const priorScope = intentionScopePerTabId.get(tabId) || null;
            const newScope = lookupIntentionScopeId(url);
            if (newScope) {
              intentionScopePerTabId.set(tabId, newScope);
              if (priorScope === null || priorScope !== newScope) {
                updateIntentionScopeActivity(newScope);
                debugLog(
                  '[Intender] Intentions changed: mapped tab to scope and updated activity',
                  {
                    tabId: tabIdToNumber(tabId),
                    url,
                    newScope,
                    priorScope: priorScope || null,
                  }
                );
              }
            } else if (priorScope) {
              intentionScopePerTabId.delete(tabId);
              debugLog(
                '[Intender] Intentions changed: cleared scope mapping for tab',
                {
                  tabId: tabIdToNumber(tabId),
                  url,
                  priorScope,
                }
              );
            }
          }
        } catch (e) {
          debugLog(
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

      // Debug logging updated (controls both console and storage logging)
      if (changes.debugLogging) {
        const { debugLogging: newDebugLogging } = await storage.get();
        const enabled = newDebugLogging ?? false;
        setDebugLogging(enabled);
      }
    } catch (error) {
      console.error('[Intender] Failed handling storage change:', error);
    }
  });

  // NOW start the async initialization after all listeners are registered
  await hydrateSessionState();

  // Initialize window focus tracking
  const initialWindowId = await resolveFocusedWindowId();
  if (initialWindowId) {
    lastFocusedWindowId = initialWindowId;
    debugLog('[Intender] Initialized focused window:', lastFocusedWindowId);

    // Seed lastActiveTabIdByWindow for the focused window
    try {
      const [activeTab] = await browser.tabs.query({
        active: true,
        windowId: windowIdToNumber(initialWindowId),
      });
      // Seed, do not overwrite: the session already knows which tab the
      // user came from, while the browser only knows which tab is active
      // now - on a restart, the one whose activation woke the worker.
      if (
        activeTab &&
        typeof activeTab.id === 'number' &&
        !lastActiveTabIdByWindow.has(initialWindowId)
      ) {
        const activeTabId = numberToTabId(activeTab.id);
        lastActiveTabIdByWindow.set(initialWindowId, activeTabId);
        debugLog('[Intender] Seeded active tab for focused window:', {
          windowId: initialWindowId,
          tabId: activeTabId,
        });
        persistSession();
      }
    } catch (tabError) {
      debugLog('[Intender] Failed to seed active tab:', tabError);
    }
  }

  // Load intentions and settings on startup
  try {
    const {
      intentions,
      inactivityMode: storedInactivityMode = 'off',
      inactivityTimeoutMs: storedInactivityTimeoutMs = minutesToMs(30),
      debugLogging: storedDebugLogging = false,
    } = await storage.get();
    const parsedIntentions = mapNulls(parseIntention, intentions);
    intentionIndex = createIntentionIndex(parsedIntentions);

    inactivityMode = storedInactivityMode as InactivityMode;
    inactivityTimeoutMs = storedInactivityTimeoutMs as TimeoutMs;
    setDebugLogging(storedDebugLogging);
    updateIdleDetectionInterval(inactivityTimeoutMs);
    toggleIdleDetection(inactivityMode);

    // Now reconcile using a ready intentionIndex
    await reconcileStateWithBrowser(
      intentionIndex,
      updateIntentionScopeActivity
    );
  } catch (error) {
    console.error('[Intender] Failed to load intentions on startup:', error);
  } finally {
    // Open the gate only here: a handler released between the settings load
    // and this point would decide against a half-reconciled snapshot. The
    // finally also covers a failed startup, which must not leave every
    // handler waiting out the gate's timeout.
    intentionIndexReady = true;
  }
});
