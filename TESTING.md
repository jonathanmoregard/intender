# Intender Testing Guide

## Automated regression checks

1. Run `npm test` for matching, import/storage, and background lifecycle tests.
   Background tests run the real event handlers with browser APIs replaced at
   their boundary, including navigation, focus loss, hydration, and rule edits.
2. Run `npm run compile` and `npx tsc --noEmit -p tests-e2e/tsconfig.json` for
   application and browser-test type checks. `npm run test:coverage -- --run`
   includes settings TSX; browser tests are not included in this coverage report.
3. Run `npm run test:e2e` for both browser projects. Failures in either project
   propagate to the command's exit status, including repeated/throttled runs.
4. For the import and navigation regressions without live websites, run
   `npm run build` followed by
   `npx playwright test tests-e2e/import-export.spec.ts tests-e2e/navigation-regressions.spec.ts --project=e2e-parallel`.
   These tests use real extension pages, downloads, storage, and worker shutdown;
   navigation responses are fulfilled locally by Playwright. One exception:
   Chromium follows a redirect produced by `route.fulfill` without handing the
   follow-up request back to Playwright, so the server-redirect test does resolve
   and request `example.com`. It fails on a host whose resolver does not answer
   for that name.

Install Playwright Chromium before browser tests. A Chrome build from the
distribution will not do: Chrome removed `--load-extension`, so the extension
never loads and every test waits for a service worker that never appears. When
using another Chrome for Testing build, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable. The
fixture-based regressions can use `PLAYWRIGHT_HEADLESS=1`; desktop focus/audio
tests should run headed (the default, using Xvfb in CI). A browser launch failure
does not verify an extension behavior and must be reported separately.

For installation and distribution instructions, see [SHARING_GUIDE.md](./SHARING_GUIDE.md).

For bug reporting, use our [Bug Report Template](./BUG_REPORT_TEMPLATE.md).

## General Testing Areas

### Cross-Platform Testing

- **Mobile**: Test on mobile browsers (Chrome Mobile, Safari Mobile)
- **Firefox**: Test Firefox-specific features and compatibility
- **Safari**: Test Safari extension compatibility
- **Edge**: Test Edge browser compatibility

### Cross-Device Sync Functionality

- Test intention rules synchronization across devices
- Verify settings persistence across browser instances
- Test sync conflicts resolution

### Intention Page Testing

- **Long phrases**: Test with very long intention phrases
- **Special characters**: Test with unicode, emojis, special symbols
- **Accessibility**: Test with screen readers, keyboard navigation
- **Performance**: Test with slow connections, large phrases

### Settings Page Testing

- **Mobile**: Test responsive design on mobile devices
- **Performance**: Test with many intention rules
- **Accessibility**: Test keyboard navigation, screen readers

### Extension Lifecycle Testing

- **Install/Uninstall**: Test clean installation and removal
- **Updates**: Test extension updates and data persistence
- **Permissions**: Test permission requests and handling
- **Incognito**: Test private browsing mode functionality

## E2E - Multi-Tab Testing Scenarios

### Core Functionality Tests

#### 1. Basic Single Tab Flow

**Objective**: Verify basic intention check functionality in a single tab
**Steps**:

1. Configure an intention rule for "facebook.com"
2. Open a new tab and navigate to facebook.com
3. Verify intention page appears with correct intention text
4. Enter the correct intention phrase
5. Verify navigation to facebook.com succeeds
6. Navigate within facebook.com (different pages)
7. Verify no additional intention pages appear

**Expected Results**:

- Intention page shows on first visit
- Correct intention text is displayed
- Navigation succeeds after correct input
- No intention pages on subsequent navigation within same domain

#### 2. Cross-Domain Navigation

**Objective**: Verify allowList clearing when navigating between domains
**Steps**:

1. Configure intention rules for "facebook.com" and "twitter.com"
2. Visit facebook.com, complete intention check, navigate to site
3. Navigate to google.com (different domain)
4. Navigate back to facebook.com
5. Verify intention page appears again

**Expected Results**:

- First visit to facebook.com shows intention page
- Navigation to google.com clears allowList
- Return to facebook.com shows intention page again

#### 3. Multi-Tab Independent Behavior

**Objective**: Verify each tab is evaluated independently based on active tab state
**Steps**:

1. Configure intention rule for "facebook.com"
2. Open Tab A, visit facebook.com, complete intention check
3. Open Tab B, visit facebook.com
4. Verify Tab B shows pause page

**Expected Results**:

- Tab A allows navigation within facebook.com
- Tab B shows pause page on first visit

#### 4. Tab Closure and Reopening

**Objective**: Verify allowList clearing when tabs are closed
**Steps**:

1. Configure intention rule for "facebook.com"
2. Visit facebook.com, complete intention check
3. Close the tab completely
4. Open new tab, visit facebook.com
5. Verify pause page appears

**Expected Results**:

- New tab shows pause page (allowList cleared on tab closure)
- No cached state persists between tab sessions

#### 5. Multiple Intention Rules

**Objective**: Verify behavior with multiple configured sites
**Steps**:

1. Configure intention rules for "facebook.com" and "twitter.com"
2. Open Tab A, visit facebook.com, complete intention check
3. Open Tab B, visit twitter.com, complete intention check
4. In Tab A, navigate to twitter.com
5. Verify pause page appears for twitter.com

**Expected Results**:

- Each domain requires its own intention check
- allowList is domain-specific, not site-specific
- Navigation between different configured sites shows pause pages

### Edge Case Scenarios

#### 6. Rapid Tab Switching

**Objective**: Verify stability during rapid tab operations
**Steps**:

1. Configure intention rule for "facebook.com"
2. Open multiple tabs quickly
3. Navigate to facebook.com in each tab rapidly
4. Complete intention checks in different tabs
5. Switch between tabs rapidly

**Expected Results**:

- No crashes or errors
- Each tab maintains correct state
- Intention checks work correctly in all tabs

#### 7. Tab Duplication

**Objective**: Verify behavior when duplicating tabs
**Steps**:

1. Configure intention rule for "facebook.com"
2. Visit facebook.com, complete intention check
3. Duplicate the tab (Ctrl+Shift+D or right-click → Duplicate)
4. Verify behavior in duplicated tab

**Expected Results**:

- If facebook tab is active when duplicating: duplicated tab enter automatically
- If facebook tab is not active: undefined (whatever is ok)
- Original tab maintains its state
- Each tab operates independently based on current state

#### 8. Incognito/Private Mode

**Objective**: Verify behavior in private browsing mode
**Steps**:

1. Configure intention rule for "facebook.com"
2. Open incognito/private window
3. Visit facebook.com
4. Complete intention check
5. Open another incognito tab, visit facebook.com

**Expected Results**:

- Intention checks work in private mode
- allowList state is maintained within private session
- No data leakage between private and normal modes

#### 9. Extension Reload/Update

**Objective**: Verify state persistence during extension updates
**Steps**:

1. Configure intention rule for "facebook.com"
2. Visit facebook.com, complete intention check
3. Reload extension (developer mode)
4. Navigate within facebook.com
5. Open new tab, visit facebook.com

**Expected Results**:

- Existing tabs maintain allowList state
- New tabs show pause page (fresh allowList)
- Extension reload doesn't affect active tabs

#### 10. Network Interruptions

**Objective**: Verify behavior during network issues
**Steps**:

1. Configure intention rule for "facebook.com"
2. Start navigation to facebook.com
3. Disconnect network during pause page load
4. Reconnect network
5. Complete intention check

**Expected Results**:

- Pause page loads correctly when network returns
- Intention check works after network restoration
- No state corruption during network interruptions

### Performance and Memory Tests

#### 11. Memory Leak Prevention

**Objective**: Verify allowList doesn't grow indefinitely
**Steps**:

1. Open 50+ tabs
2. Visit configured sites in each tab
3. Close tabs randomly
4. Monitor memory usage
5. Verify allowList cleanup

**Expected Results**:

- Memory usage remains stable
- allowList entries are properly cleaned up
- No memory leaks from tab closures

### Browser-Specific Tests

#### 12. Chrome-Specific Features

**Objective**: Verify Chrome-specific tab management
**Steps**:

1. Use Chrome tab groups
2. Pin/unpin tabs
3. Test with Chrome's tab search feature
4. Verify with Chrome's tab preview hover

**Expected Results**:

- Intention checks work with tab groups
- Pinned tabs maintain state correctly
- Tab management features don't interfere

#### 13. Firefox-Specific Features

**Objective**: Verify Firefox-specific tab management
**Steps**:

1. Use Firefox tab containers
2. Test with Firefox's tab preview
3. Use Firefox's tab management features
4. Verify with Firefox's private browsing

**Expected Results**:

- Intention checks work with containers
- Tab previews show correct state
- Firefox-specific features don't interfere

### Accessibility and UX Tests

#### 14. Keyboard Navigation

**Objective**: Verify keyboard accessibility across tabs
**Steps**:

1. Use keyboard to navigate between tabs
2. Complete intention checks using only keyboard
3. Test with screen readers
4. Verify focus management

**Expected Results**:

- Keyboard navigation works correctly
- Focus is properly managed
- Screen reader compatibility

#### 15. Visual State Consistency

**Objective**: Verify visual feedback across tabs
**Steps**:

1. Open multiple tabs with pause pages
2. Verify consistent visual styling
3. Test with different zoom levels
4. Verify responsive design

**Expected Results**:

- Consistent visual appearance
- Proper responsive behavior
- No visual glitches across tabs

## Test Data Setup

### Sample Intention Rules

```json
[
  {
    "url": "facebook.com",
    "phrase": "I am connecting with friends and family, not mindlessly scrolling"
  },
  {
    "url": "twitter.com",
    "phrase": "I am staying informed, not getting distracted by endless feeds"
  },
  {
    "url": "youtube.com",
    "phrase": "I am learning something specific, not falling into recommendation loops"
  }
]
```

### Test URLs

- `https://facebook.com`
- `https://www.facebook.com`
- `https://m.facebook.com`
- `https://twitter.com`
- `https://youtube.com`
- `https://google.com` (control - no intention rule)
