## Inactivity intention page: scope-level spec

### Goals

- Handle idle intentions by intention scope, not per tab.
- For active tab: OS idle (≥15s). For background tabs handle in onActivated
- Audio exemption by scope when mode is on-except-audio.
- Same-scope tab switches should not go to intention page.

### Data model

- `lastActiveByScope: Map<IntentionScopeId, Timestamp>` — last activity per scope.
- `intentionScopePerTabId: Map<TabId, IntentionScopeId>` — current scope for a tab (clear when unmatched).
- `audibleTabsByScope: Map<IntentionScopeId, Set<TabId>>` — audible tab IDs per scope.
- `lastActiveTabIdByWindow: Map<WindowId, TabId>` — previous active tab per window (used to resolve “from” on activation).
- `lastFocusedWindowId: WindowId | null` — last focused window id to support "from" bumps in `windows.onFocusChanged`.
- `lastRedirectAtByTabId: Map<TabId, Timestamp>` — per-tab redirect cooldown timestamps to prevent duplicate redirects across idle/focus races.

### Helpers

- `getScopeForTab(tabId, url?) -> IntentionScopeId | null`
  - Resolution order:
    1. `intentionScopePerTabId.get(tabId)` if present
    2. derive via `tabUrlMap.get(tabId)` → scope lookup
    3. otherwise return null
  - Must tolerate missing data and return null when unresolved.
  - Important: The intention page URL is NOT a scope. Do not treat the intention page as being “in” the scope for same-scope decisions; only real destination pages count.
- `shouldTriggerInactivityIntentionCheck(mode, scopeId) -> boolean`
  - If `scopeId` is null: false
  - If `lastActiveByScope[scopeId]` is missing (first seen): false (initialize via normal bump path)
  - off: false
  - on: `now - lastActiveByScope[scopeId] >= inactivityTimeoutMs`
  - on-except-audio: if `isScopeAudible(scopeId)` then false, else same delta check
- `isScopeAudible(scopeId) -> boolean`
  - True iff `audibleTabsByScope.get(scopeId)?.size > 0`.
- `updateIntentionScopeActivity(scopeId)` — set `lastActiveByScope[scopeId] = now()`.
- `redirectToIntentionPage(tabId, toScope)` — centralized redirect with guards
  - If `toScope` is null: return
  - If tab URL starts with intention page URL: return
  - If `now - lastRedirectAtByTabId[tabId] < 300ms`: return (per-tab cooldown)
  - If `shouldTriggerInactivityIntentionCheck(settings.inactivityMode, toScope)`:
    - Redirect tab to intention page for `toScope`
    - Set `lastRedirectAtByTabId[tabId] = now`
  - Else:
    - `updateIntentionScopeActivity(toScope)`

### Event handling

- `browser.webNavigation.onCommitted` — main-frame navigation committed
  - Update `tabUrlMap`.
  - If the destination matches an intention: set `intentionScopePerTabId[tabId] = scopeId` and `updateIntentionScopeActivity(scopeId)`.
  - Else: clear `intentionScopePerTabId[tabId]` (prevents stale scope redirects) and, if the tab previously had a scope mapping, remove this `tabId` from that scope’s `audibleTabsByScope` (avoids stale audio exemptions when leaving scope).

- `browser.webNavigation.onBeforeNavigate` — pre-navigation routing rules
  - Keep the existing 4-rule model. No inactivity-specific changes.

- `browser.tabs.onCreated` — tab created
  - Cache the initial URL in `tabUrlMap` if present.

- `browser.windows.onFocusChanged` — window focus changed
  - Update tracking: `const prevWindowId = lastFocusedWindowId; lastFocusedWindowId = windowId`.
  - From bump: using `prevWindowId`, look up `prevTabId = lastActiveTabIdByWindow.get(prevWindowId)`; if present, `updateIntentionScopeActivity(getScopeForTab(prevTabId))`.
  - If `windowId === -1`: return (only perform the "from" bump above; no redirect/no "to" bump when no window is focused).
  - To check: get the active tab in the newly focused window; resolve `toScope = getScopeForTab(activeTab.id)`.
  - Call `redirectToIntentionPage(activeTab.id, toScope)`.
  - note: Do not update `lastActiveTabIdByWindow` here; it is maintained by `tabs.onActivated`.
  - note: If no active tab is found, skip gracefully.

- `browser.tabs.onActivated` — tab focus changed
  - Track previous active per window via `lastActiveTabIdByWindow`.
  - On activation (windowId = `activeInfo.windowId`):
    1. Resolve scope for the “from” tab (lookup `fromTab = lastActiveTabIdByWindow.get(windowId)`); if present, `updateIntentionScopeActivity(getScopeForTab(fromTab))`.
    2. Resolve scope for the “to” tab (`toIntentionScope`)
    3. Call `redirectToIntentionPage(activeInfo.tabId, toIntentionScope)`.
  - Finally, set `lastActiveTabIdByWindow.set(windowId, activeInfo.tabId)`.

- `browser.tabs.onUpdated` (with `audible`) — audio state change
  - `audible = true`: mark tab audible for the scope; `updateIntentionScopeActivity(scopeId)`.
  - `audible = false`: `updateIntentionScopeActivity(scopeId)` first, then unmark the tab from the audible set.
  - `mutedInfo` changed: treat `muted === true` as not audible; update exemption state accordingly (and vice versa for unmuted).

- `browser.tabs.onRemoved` — tab closed
  - Clean `tabUrlMap`, `intentionScopePerTabId[tabId]`, and remove the tab from any scope’s audible set.

- `browser.windows.onRemoved` — window closed
  - Cleanup: delete `lastActiveTabIdByWindow[windowId]` to prevent stale "from" lookups later.

- `chrome.idle.onStateChanged` — OS idle/active state
  - `'idle'`:
    - If there is a window in focus, fetch its active tab info. If not, return. (is handled by windows.onFocusChanged)
    - Resolve scope via `getScopeForTab(tabId, url)`. If none, return.
    - If mode is `on-except-audio` and `isScopeAudible(scopeId)`, return.
    - Redirect that active tab to the intention page for the scope.
    - Only redirect the focused window’s active scoped tab; other windows revalidate on activation (tab/window focus).

- `browser.storage.onChanged` — intentions/settings changed
  - On `intentions`: rebuild the intention index.
  - On `inactivityMode`/`inactivityTimeoutMs`: refresh snapshot, update idle detection interval, and rewire idle listener.

### Logging (minimal)

- Windows focus: `prevWindowId`, `prevTabId`/`prevScope` → `windowId`.
- Focus: `windowId`, `fromTabId`/`fromScope` → `toTabId`/`toScope`.
- Commit: tabId, scope set/cleared.
- Audio: tabId, scope, on/off.
- Idle: chosen tab, scope, mode, audible exemption decision.

---

## E2E tests

Note: Keep tests behavior-only (no impl details). Prefer short, high-signal cases. Use the existing force-idle hook for sub-15s cases; use real OS idle only for the long test. Mark long/OS-idle tests as serial.

1. Idle on (3s). Navigate to page with intention, pass the intention check, wait > timeout (force idle through hook), should show intention page.
2. Idle on-except-audio (3s). Same as 1 (no audio), should show intention page.

3. Idle on (3s). Navigate to page with intention, pass the intention check, open another tab (any). Wait > timeout, switch back to scoped tab, should show intention page.
4. Same as 3 but on-except-audio.

5. Idle on-except-audio (3s). Navigate to test audio page with intention, pass the intention check, start audio, duplicate the tab. Wait > timeout, focusing either should remain on the audio page (audio exemption).
6. Idle on-except-audio (3s). Navigate to test audio page with intention, pass the intention check, start audio, duplicate tab, open a new non-scope tab, wait > timeout, focusing the duplicate stays on audio page; focusing the original stays on audio page.

6b. Same as 6, but the duplicate is moved to it's own window just after creation

7. Idle on (3s). Navigate to a site with intention, pass the intention check, open 5 other tabs within same site, go idle, return to intention page (pass the intention check again), focusing the other same-site tabs should not show intention page.
8. Same as 7 but on-except-audio.

9. Mapping cleared when leaving scope:

- Navigate to scoped page and pass the intention check; navigate away to a non-scoped page; wait > timeout (force idle). No intention page should appear. Navigating back to scoped page behaves normally.

10. Same-scope tab switch is safe:

- Open and pass the intention check intention for 2 tabs in the same scope. Work (stay active) on tab A longer than timeout; switch to tab B. No intention page should appear (no idle, and same-scope switch is activity-safe).

11. Pause audio in-place (grace on audible off):

- Idle on-except-audio (3s). On audio test page: pass the intention check, play audio, wait ~2s, pause audio in the same tab, then approach timeout and focus remains. Should not immediately show intention page (activity was refreshed when audio stopped).

13. Long OS idle (serial, real OS idle):

- Idle on, timeout 16s. Navigate with intention, pass the intention check, do nothing for ≥17s. Expect intention page (uses real OS idle; serial to avoid flakiness).

14. Work long in one tab

- open & pass the intention check intention for 2 tabs in same scope, work on tab1 for over inactivity time, open new tab, switch to intention-scope tab2, should be intention-scope tab2 (not intention screen)

15. Parallel audibles within a scope (close-one/close-last):

- Idle on-except-audio (3s). Two tabs in the same scope playing audio. Stop audio in one tab; wait > timeout; focusing either tab should remain on the destination (exemption holds). Close the last audible tab; wait > timeout; focusing the scope should now show the intention page (exemption removed).

16. Cross-window same-scope switch:

- Open and pass the intention check intention for one tab in Window A and one tab in Window B (same scope). Work in the Window A tab beyond the timeout, then focus Window B. Expect no intention page

17. Muted-audio exemption correctness

- on-except-audio: audio playing but tab muted. Expect intention page (muted should not count as audible).

18. Intention page is not a scope

- Create an intention for the intention page url, and one more for google. go to google, verify intention page has the google-intention text. Go to settings, verify intention page intention has errored url box.

19. Multi window tests:

- Two windows, one tab in each (sharing scope), stale scoped tab in B. Focus a, go idle. Focus B window. Expect intention page.
- Two windows, one tab in each (sharing scope). Keep active for over timeout-duration in A, focus B. Expect no intention page.
- (timeout 10s) - Two windows (A & B), A has tabs a a' - B tab b. a & b share scope, a' doesn't. Open both a and b (pass intention). Focus on b, then close window. Wait 5s. Switch to a'. Wait 6s. Switch to a. Expect intention page

20. Race condition idle:

- Navigate to page with intention, pass the intention check, new tab, wait > timeout, "force idle through hook" & focus tab at the same time. Verify no double redirects.

21. Focusing DevTools or an extension popup can change window focus without a valid active tab. Handlers should tolerate missing/invalid active tabs (no exceptions, no redirects). Verify safe no-op behavior. Succinct: Focus DevTools/popup window → no errors, no intention page.

Notes:

- Where force is needed, use the existing e2e “force idle” hook only for sub-15s tests.
- Keep assertions to URLs: either intention page URL with target param or the destination URL.
- Ensure tests do not rely on browser focus-based revalidation; behavior is idle-driven.

---

## Other

- Add `getScopeForTab` and `scopeInactive` helpers (pure functions).
- audible need to keep track of muted info - muted tabs can be "audible" for chrome, but not for us. Treat mutedInfo.muted === true as not audible; update exemption on tabs.onUpdated for mutedInfo changes.
- Stale URL vs scope mapping. Symptom: Using tabUrlMap before it’s current can mis-resolve scope. Mitigation: getScopeForTab must prefer intentionScopePerTabId and only fall back to tabUrlMap; clear mapping on unmatched commits.
- Spurious re-activations. Symptom: tabs.onActivated fires redundantly for the same tab. Mitigation: If fromTab === toTab, skip “from” bump and any checks.
- Window unfocused at idle time
- First-seen scopes. Symptom: No lastActive yet. Treat first observation as active (no intention page) and set lastActive then.
- Before redirecting, check if the target tab is already on the intention page URL; skip if so. Avoids certain race conditions such as "Duplicate triggers (idle and focus near-simultaneous)"
- Ensure handlers tolerate missing/stale “from” references and always evaluate the “to” tab’s scope on activation.
- Per-tab short redirect cooldown (e.g., 300–500 ms) to avoid back-to-back attempts from near-simultaneous idle/focus.
