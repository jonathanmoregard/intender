import type { Page } from '@playwright/test';
import { AudioTestPage } from './fixtures/page/audio-test';
import { IntentionPage } from './fixtures/page/intention';
import { SettingsPage } from './fixtures/page/settings';

import { execSync } from 'node:child_process';
import { expect, test } from './test-setup';
import { launchExtension, openSettingsPage } from './utils/extension';

// Helper to get current test name with run number
function getTestNameWithRun(): string {
  const testInfo = test.info();
  const testName = testInfo.title;
  const runNumber = testInfo.repeatEachIndex + 1;
  return `${testName} (run ${runNumber})`;
}

test.describe.configure({ mode: 'parallel' });

async function gotoRobust(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    // Ignore navigation errors caused by redirects to intention page
    console.log(
      `Navigation to ${url} redirected or aborted (expected for scoped URLs)`
    );
  }

  // Special-case: when explicitly navigating to about:blank, accept it as the
  // stable end state and return once it is reached.
  if (url === 'about:blank') {
    try {
      await page.waitForURL('about:blank', { timeout: 5000 });
    } catch {}
    return;
  }

  // Ensure we don't return while still at about:blank or empty URL.
  // Wait for either the intention page, the exact target URL, or simply a non-blank URL.
  try {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetRegex = new RegExp(escaped);
    await Promise.race([
      page.waitForURL(IntentionPage.regex, { timeout: 15000 }),
      page.waitForURL(targetRegex, { timeout: 15000 }),
      page.waitForFunction(
        () => location.href !== '' && location.href !== 'about:blank',
        { timeout: 15000 }
      ),
    ]);
  } catch {
    // Best-effort stabilization; safe to proceed for callers that do their own waits
  }
}

async function bringToFrontAndWait(page: Page): Promise<void> {
  await page.bringToFront();
  // Simple timeout-based wait instead of CSP-blocked waitForFunction
  await page.waitForTimeout(200);
}

async function setupInactivityAndIntention(opts: {
  context: any;
  timeoutMs: number;
  inactivityMode: 'off' | 'all' | 'all-except-audio';
  url: string;
  phrase: string;
}) {
  const { settingsPage } = await openSettingsPage(opts.context, {
    e2eInactivityTimeoutMs: opts.timeoutMs,
  });

  const advancedToggle = settingsPage.getByTestId('advanced-settings-toggle');
  await advancedToggle.waitFor({ state: 'visible' });
  await advancedToggle.scrollIntoViewIfNeeded();
  await advancedToggle.click();

  await settingsPage
    .getByTestId(`inactivity-mode-${opts.inactivityMode}`)
    .click();

  await SettingsPage.addIntention(settingsPage, {
    url: opts.url,
    phrase: opts.phrase,
  });

  return { settingsPage };
}

async function createNewWindowFromTab(
  sourceTab: Page,
  url: string
): Promise<Page> {
  const [newWindow] = await Promise.all([
    sourceTab.waitForEvent('popup'),
    sourceTab.evaluate(url => {
      // Hint to Chromium to open a popup window rather than a tab
      // (features string helps produce a separate window + windowId in Chrome)
      window.open(url, '_blank', 'popup=1,width=1200,height=800');
      return null;
    }, url),
  ]);
  return newWindow;
}

async function forceInactivityCheck(optionsPage: Page) {
  await optionsPage.evaluate(() => {
    // @ts-ignore
    chrome.runtime.sendMessage({ type: 'e2e:forceInactivityCheck-idle' });
  });
}

async function toggleOsIdleEnabled(optionsPage: Page, enabled: boolean) {
  await optionsPage.evaluate(enabledArg => {
    // @ts-ignore
    chrome.runtime.sendMessage({ type: 'e2e:setOsIdle', enabled: enabledArg });
  }, enabled);
}

// Parallel-safe tests (can run concurrently)
test.describe('Inactivity revalidation - parallel safe', () => {
  test('test-1: timeout in ms and revalidation on tab focus after inactivity', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    const otherTab = await context.newPage();
    await otherTab.goto('about:blank');
    await bringToFrontAndWait(otherTab);
    await settingsPage.waitForTimeout(1500);

    await bringToFrontAndWait(tab);
    await expect(tab).toHaveURL(IntentionPage.regex);

    await context.close();
  });

  test('test-2: same-scope tab with audio should bypass inactivity revalidation', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Open another tab with the same fixture (same scope) with audio and start playback
    const audioTab = await context.newPage();
    await gotoRobust(audioTab, AudioTestPage.url);
    await IntentionPage.complete(audioTab, testPhrase);

    await AudioTestPage.play(audioTab);

    // Wait beyond inactivity
    await settingsPage.waitForTimeout(1500);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Bring tab tab to front, should NOT redirect due to audible exemption in same scope
    await tab.bringToFront();
    await expect(tab).toHaveURL(AudioTestPage.regex);

    await context.close();
  });

  test('test-3: active tab with audio should not revalidate while passively listening', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    // Open an audio tab and start playback
    const audioTab = await context.newPage();
    await gotoRobust(audioTab, AudioTestPage.url);
    await IntentionPage.complete(audioTab, testPhrase);
    await AudioTestPage.play(audioTab);

    // Stay on audio tab and wait beyond inactivity
    await audioTab.waitForTimeout(1500);
    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);
    // No redirect expected due to audio exemption
    await expect(audioTab).not.toHaveURL(/chrome-extension:\/\//);

    await context.close();
  });

  // Test 4: Idle on (3s). Navigate to page with intention, pass the intention check, open another tab (any). Wait > timeout, switch back to scoped tab, should show intention page.
  test('test-4: open another tab, wait timeout, switch back shows intention page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Open another tab (any)
    const other = await context.newPage();
    await other.goto('about:blank');
    await bringToFrontAndWait(other);

    // Wait beyond timeout
    await settingsPage.waitForTimeout(1500);

    // Switch back to scoped tab - should show intention page
    await bringToFrontAndWait(tab);
    await expect(tab).toHaveURL(IntentionPage.regex);

    await context.close();
  });

  // Test 5: Same as 4 but on-except-audio.
  test('test-5: open another tab, wait timeout, switch back shows intention page (all-except-audio mode)', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Open another tab (any)
    const other = await context.newPage();
    await other.goto('about:blank');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(1500);

    // Switch back to scoped tab - should show intention page
    await tab.bringToFront();
    await expect(tab).toHaveURL(IntentionPage.regex);

    await context.close();
  });

  // Test 6: Idle on-except-audio (3s). Navigate to test audio page with intention, pass the intention check, start audio, duplicate the tab. Wait > timeout, focusing either should remain on the audio page (audio exemption).
  test('test-6: duplicate audio tab, both stay on audio page due to exemption', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Start audio
    await AudioTestPage.play(tab);

    // Duplicate the tab - it will need to complete intention too
    const duplicate = await context.newPage();
    await gotoRobust(duplicate, AudioTestPage.url);
    await IntentionPage.complete(duplicate, testPhrase);

    // Wait beyond timeout
    await settingsPage.waitForTimeout(1500);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Focus original - should remain on audio page (audio exemption)
    await tab.bringToFront();
    await expect(tab).toHaveURL(AudioTestPage.regex);

    // Focus duplicate - should also remain on audio page (audio exemption)
    await duplicate.bringToFront();
    await expect(duplicate).toHaveURL(AudioTestPage.regex);

    await context.close();
  });

  // Test 7: Idle on-except-audio (3s). Navigate to test audio page with intention, pass the intention check, start audio, duplicate tab, open a new non-scope tab, wait > timeout, focusing the duplicate stays on audio page; focusing the original stays on audio page.
  test('test-7: duplicate audio tab with non-scope tab, both stay on audio page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Start audio
    await AudioTestPage.play(tab);

    // Duplicate the tab - it will need to complete intention too
    const duplicate = await context.newPage();
    await gotoRobust(duplicate, AudioTestPage.url);
    await IntentionPage.complete(duplicate, testPhrase);

    // Open a new non-scope tab
    const nonScopeTab = await context.newPage();
    await gotoRobust(nonScopeTab, 'https://google.com');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(1500);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Focus duplicate - should stay on audio page
    await duplicate.bringToFront();
    await expect(duplicate).toHaveURL(AudioTestPage.regex);

    // Focus original - should stay on audio page
    await tab.bringToFront();
    await expect(tab).toHaveURL(AudioTestPage.regex);

    await context.close();
  });

  // Test 8: Same as 7, but the duplicate is moved to its own window just after creation
  test('test-8: duplicate audio tab in separate window, both stay on audio page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Start audio
    await AudioTestPage.play(tab);

    // Create duplicate in a *new window* (same context) via window.open
    const newWindow = await createNewWindowFromTab(tab, AudioTestPage.url);

    // Complete intention in the new window
    await IntentionPage.complete(newWindow, testPhrase);

    // Start audio in the new window
    await AudioTestPage.play(newWindow);

    // Open a new non-scope tab
    const nonScopeTab = await context.newPage();
    await gotoRobust(nonScopeTab, 'https://google.com');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(1500);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Focus duplicate in new window - should stay on audio page (audio exemption)
    await newWindow.bringToFront();
    await expect(newWindow).toHaveURL(AudioTestPage.regex);

    // Focus original - should stay on audio page (audio exemption)
    await tab.bringToFront();
    await expect(tab).toHaveURL(AudioTestPage.regex);

    await context.close();
  });

  // Test 9: Mapping cleared when leaving scope
  test('test-9: navigate away from scope, then idle should not trigger intention page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Navigate away to a non-scoped page
    await gotoRobust(tab, 'https://google.com');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(1500);

    // Force idle - should not trigger intention page
    await forceInactivityCheck(settingsPage);
    await tab.waitForTimeout(500);

    // Should still be on google.com
    await expect(tab).toHaveURL(/https:\/\/(www\.)?google\.com/);

    // Navigate back to scoped page - should behave normally (show intention page)
    await gotoRobust(
      tab,
      'https://jonathanmoregard.github.io/intender/test/assets/'
    );
    await expect(tab).toHaveURL(IntentionPage.regex);

    await context.close();
  });

  // Test 10: Same-scope tab switch is safe
  test('test-10: same-scope tab switch should not trigger intention page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 2000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    // Open and pass intention check for first tab
    const tabA = await context.newPage();
    await gotoRobust(tabA, AudioTestPage.url);
    await IntentionPage.complete(tabA, testPhrase);

    // Open second tab in same scope
    const tabB = await context.newPage();
    await gotoRobust(
      tabB,
      'https://jonathanmoregard.github.io/intender/test/assets/'
    );
    await expect(tabB).toHaveURL(IntentionPage.regex);
    await IntentionPage.complete(tabB, testPhrase);

    // Work on tab A longer than timeout (stay active)
    await bringToFrontAndWait(tabA);
    await tabA.waitForTimeout(1500);

    // Switch to tab B - should NOT show intention page (same-scope switch is safe)
    await bringToFrontAndWait(tabB);
    await expect(tabB).toHaveURL(AudioTestPage.regex);
    await tabB.waitForTimeout(100); // Settle time to prevent double-fires

    await context.close();
  });

  // Test 11: Pause audio in-place (grace on audible off)
  test('test-11: pause audio should refresh activity, delay intention page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Start audio
    await AudioTestPage.play(tab);

    // Wait ~2s
    await tab.waitForTimeout(2000);

    // Pause audio in the same tab
    await tab.evaluate(() => {
      // @ts-ignore
      const audio = document.querySelector('audio');
      if (audio) {
        audio.pause();
      }
    });

    // Wait a bit more but still under original timeout since activity was refreshed
    await tab.waitForTimeout(2500);

    // Should NOT immediately show intention page (activity was refreshed)
    await expect(tab).toHaveURL(AudioTestPage.regex);

    await context.close();
  });

  // Test 12: Work long in one tab
  test('test-12: work long in one tab, switch to other same-scope tab should not show intention', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    // Open and pass intention check for 2 tabs in same scope
    const tab1 = await context.newPage();
    await gotoRobust(tab1, AudioTestPage.url);
    await IntentionPage.complete(tab1, testPhrase);

    const tab2 = await context.newPage();
    await gotoRobust(tab2, AudioTestPage.url);
    await expect(tab2).toHaveURL(IntentionPage.regex);
    await IntentionPage.complete(tab2, testPhrase);

    // Work on tab1 for over inactivity time
    await tab1.bringToFront();
    await tab1.waitForTimeout(2500);

    // Switch to intention-scope tab2 - should be tab2 (not intention screen)
    await tab2.bringToFront();
    await expect(tab2).toHaveURL(AudioTestPage.regex);

    await context.close();
  });

  // Test 13: Parallel audibles within a scope (close-one/close-last)
  test('test-13: parallel audibles, close one keeps exemption, close last removes exemption', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 2000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    // Open audio1, don't play
    const audio1 = await context.newPage();
    await gotoRobust(audio1, AudioTestPage.url);
    await IntentionPage.complete(audio1, testPhrase);

    // Open audio2, play
    const audio2 = await context.newPage();
    await gotoRobust(audio2, AudioTestPage.url);
    await IntentionPage.complete(audio2, testPhrase);
    await AudioTestPage.play(audio2);

    // Open audio3, play
    const audio3 = await context.newPage();
    await gotoRobust(audio3, AudioTestPage.url);
    await IntentionPage.complete(audio3, testPhrase);
    await AudioTestPage.play(audio3);

    // Open new tab
    const newTab = await context.newPage();
    await gotoRobust(newTab, 'https://google.com');

    // Wait over inactivity
    await settingsPage.waitForTimeout(2500);

    // Go to audio1, verify no intention
    await audio1.bringToFront();
    await audio1.waitForURL(AudioTestPage.regex);

    // Go to audio3, verify no intention
    await audio3.bringToFront();
    await audio3.waitForURL(AudioTestPage.regex);

    // Close audio3
    await audio3.close();

    // Go to new tab
    await newTab.bringToFront();

    // Wait over inactivity
    await settingsPage.waitForTimeout(2500);

    // Go to audio1, verify no intention (exemption still holds due to audio2)
    await audio1.bringToFront();
    await audio1.waitForURL(AudioTestPage.regex);

    // Go to audio2, verify no intention
    await audio2.bringToFront();
    await audio2.waitForURL(AudioTestPage.regex);

    // Close audio2
    await audio2.close();

    // Go to new tab
    await newTab.bringToFront();

    // Wait over inactivity
    await settingsPage.waitForTimeout(2500);

    // Go to audio1, verify intention (exemption removed)
    await audio1.bringToFront();
    await audio1.waitForURL(IntentionPage.regex);

    await context.close();
  });

  // Test 14: Muted-audio exemption correctness
  test('test-14: muted audio should not count as audible, expect intention page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Start audio and immediately mute it
    await AudioTestPage.play(tab);

    // Mute the tab at the browser level (not just DOM audio element)
    await settingsPage.evaluate(async () => {
      const targets = await chrome.tabs.query({
        url: '*://jonathanmoregard.github.io/intender/test/assets/*',
      });
      for (const t of targets) {
        if (t.id) await chrome.tabs.update(t.id, { muted: true });
      }
    });
    await tab.waitForTimeout(200); // let tab.mutedInfo/audible settle

    // Open new tab
    const newTab = await context.newPage();
    await gotoRobust(newTab, 'https://google.com');

    // Wait over inactivity
    await settingsPage.waitForTimeout(2500);

    // Focus tab - should show intention page (muted doesn't count as audible)
    await tab.bringToFront();
    await expect(tab).toHaveURL(IntentionPage.regex);

    await context.close();
  });

  // Test 15: Idle on (3s). Navigate to a site with intention, pass the intention check, open 5 other tabs within same site, go idle, return to intention page (pass the intention check again), focusing the other same-site tabs should not show intention page.
  test('test-15: multiple same-site tabs, after revalidation other tabs should not show intention', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 2000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    // Navigate to site and pass intention check
    const mainTab = await context.newPage();
    await gotoRobust(mainTab, AudioTestPage.url);
    await IntentionPage.complete(mainTab, testPhrase);

    // Open 3 other tabs within same site
    const sameSiteTabs = [];
    for (let i = 0; i < 3; i++) {
      const tab = await context.newPage();
      await gotoRobust(tab, AudioTestPage.url);
      await tab.waitForURL(IntentionPage.regex, { timeout: 30000 });
      await IntentionPage.complete(tab, testPhrase);
      sameSiteTabs.push(tab);
    }

    // Open new tab!
    const newTab = await context.newPage();
    await gotoRobust(newTab, 'https://google.com');

    // Wait over inactivity
    await settingsPage.waitForTimeout(1500);

    await mainTab.bringToFront();
    await expect(mainTab).toHaveURL(IntentionPage.regex);

    // Pass intention check again
    await IntentionPage.complete(mainTab, testPhrase);

    // Focus other same-site tabs - should NOT show intention page
    for (const tab of sameSiteTabs) {
      await tab.bringToFront();
      await expect(tab).toHaveURL(AudioTestPage.regex, { timeout: 30000 });
    }

    await context.close();
  });

  // Test 16: Same as 15 but all-except-audio.
  test('test-16: multiple same-site tabs, after revalidation other tabs should not show intention (all-except-audio)', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 2000,
      inactivityMode: 'all-except-audio',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    // Navigate to site and pass intention check
    const mainTab = await context.newPage();
    await gotoRobust(mainTab, AudioTestPage.url);
    await IntentionPage.complete(mainTab, testPhrase);

    // Open 3 other tabs within same site
    const sameSiteTabs = [];
    for (let i = 0; i < 3; i++) {
      const tab = await context.newPage();
      await gotoRobust(tab, AudioTestPage.url);
      await tab.waitForURL(IntentionPage.regex, { timeout: 30000 });
      await IntentionPage.complete(tab, testPhrase);
      sameSiteTabs.push(tab);
    }

    // Open new tab
    const newTab = await context.newPage();
    await gotoRobust(newTab, 'https://google.com');

    // Wait over inactivity
    await settingsPage.waitForTimeout(1500);

    await mainTab.bringToFront();
    await expect(mainTab).toHaveURL(IntentionPage.regex);

    // Pass intention check again
    await IntentionPage.complete(mainTab, testPhrase);

    // Focus other same-site tabs - should NOT show intention page
    for (const tab of sameSiteTabs) {
      await tab.bringToFront();
      await expect(tab).toHaveURL(AudioTestPage.regex, { timeout: 30000 });
    }

    await context.close();
  });

  // Test 17: Intention page is not a scope
  test('test-17: intention page URL should not be treated as a scope', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await openSettingsPage(context, {
      e2eInactivityTimeoutMs: 3000,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    const advancedToggle = settingsPage.getByTestId('advanced-settings-toggle');
    await advancedToggle.waitFor({ state: 'visible' });
    await advancedToggle.scrollIntoViewIfNeeded();
    await advancedToggle.click();
    await settingsPage.getByTestId('inactivity-mode-all').click();

    // Create intention for intention page URL (should error)
    await SettingsPage.addIntention(settingsPage, {
      url: 'chrome-extension://',
      phrase: 'This should error',
    });

    // Add another intention for google using helper at index 1
    await settingsPage.getByRole('button', { name: 'Add website' }).click();
    await SettingsPage.addIntentionAt(settingsPage, 1, {
      url: 'google.com',
      phrase: 'Google intention',
    });

    // Go to test domain, verify intention page has the correct intention text
    const testTab = await context.newPage();
    await gotoRobust(testTab, 'https://google.com');
    await expect(testTab).toHaveURL(IntentionPage.regex);
    await IntentionPage.expectLoaded(testTab);
    // Note: placeholder issue may be related to intention loading - needs investigation

    // Go to settings and verify intention page intention has errored URL box
    await settingsPage.bringToFront();
    const firstUrlInput = settingsPage.locator('input.url-input').first();
    await expect(firstUrlInput).toHaveClass(/error/);

    await context.close();
  });

  // Test 18: Race condition idle
  test('test-18: force idle and focus at same time should not cause double redirect', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Open another tab
    const otherTab = await context.newPage();
    await otherTab.goto('about:blank');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(1500);

    // Force idle and focus tab at the same time
    await Promise.all([forceInactivityCheck(settingsPage), tab.bringToFront()]);

    // Should show intention page (but only one redirect should happen)
    await expect(tab).toHaveURL(IntentionPage.regex);

    // Wait a bit to ensure no second redirect occurs
    await tab.waitForTimeout(1000);
    await expect(tab).toHaveURL(IntentionPage.regex);

    await context.close();
  });

  // Test 19: Focus DevTools or extension popup should be safe
  test('test-19: focus devtools should be safe (no errors, no intention page)', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Simulate DevTools focus by creating a situation where window focus changes
    // but no valid active tab is available (what DevTools focus would cause)

    // Wait beyond timeout to ensure we're past the inactivity threshold
    await tab.waitForTimeout(1500);

    // Focus on settings page (simulates DevTools/popup focus scenario)
    await settingsPage.bringToFront();
    await settingsPage.waitForTimeout(500);

    // The system should handle this gracefully with no errors and no redirects
    // Focus back to original tab - should remain on the target page (NO intention page)
    await tab.bringToFront();
    await expect(tab).toHaveURL(AudioTestPage.regex);

    // Verify no errors occurred (tab should still be functional)
    await expect(tab.locator('body')).toBeVisible();

    await context.close();
  });
});

// Serial tests (for OS idle behavior and cross-window focus-sensitive tests)
test.describe.serial('@serial Inactivity revalidation - Serial Tests', () => {
  // Test 20: Cross-window same-scope switch
  test('test-20: cross-window same-scope switch should not show intention page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });

    await toggleOsIdleEnabled(settingsPage, false);

    // Open and pass intention check for tab in Window A
    const tabA = await context.newPage();
    await gotoRobust(tabA, AudioTestPage.url);
    await IntentionPage.complete(tabA, testPhrase);

    // Get Window A's ID for later focus control - use getCurrent() for deterministic selection
    const windowAId = await settingsPage.evaluate(async () => {
      const currentWindow = await chrome.windows.getCurrent();
      if (!currentWindow?.id) {
        throw new Error('Failed to get current window ID');
      }
      return currentWindow.id;
    });

    // Create real Chrome window with blank tab first (Window B)
    // Tie page creation deterministically to window creation by waiting in parallel
    const [tabB, windowBInfo] = await Promise.all([
      context.waitForEvent('page', { timeout: 15000 }),
      settingsPage.evaluate(async () => {
        const window = await chrome.windows.create({
          url: 'about:blank',
          focused: true,
          type: 'normal',
        });
        if (!window || !window.id || !window.tabs?.[0]?.id) {
          throw new Error('Failed to create window or get tab ID');
        }
        return {
          windowId: window.id,
          tabId: window.tabs[0].id,
        };
      }),
    ]);

    // Now navigate to the target URL to trigger extension interception
    await gotoRobust(tabB, AudioTestPage.url);

    await expect(tabB).toHaveURL(IntentionPage.regex);
    await IntentionPage.complete(tabB, testPhrase);

    // Focus Window A and work beyond timeout
    await settingsPage.evaluate(async windowId => {
      await chrome.windows.update(windowId, { focused: true });
    }, windowAId);
    await bringToFrontAndWait(tabA);
    await tabA.waitForTimeout(1500);

    // Focus Window B using chrome.windows.update - should NOT show intention page
    await settingsPage.evaluate(async windowId => {
      await chrome.windows.update(windowId, { focused: true });
    }, windowBInfo.windowId);

    // Wait for focus change to take effect
    await tabB.waitForTimeout(200);

    await expect(tabB).toHaveURL(AudioTestPage.regex);

    await context.close();
  });
  test('test-21: two windows, stale tab in B, focus A then B should show intention', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    // Window A with scoped tab
    const tabA = await context.newPage();
    await gotoRobust(tabA, AudioTestPage.url);
    await IntentionPage.complete(tabA, testPhrase);

    // Window B with scoped tab (same scope) - create as separate window
    const tabB = await createNewWindowFromTab(tabA, AudioTestPage.url);
    await IntentionPage.complete(tabB, testPhrase);

    // Focus A, go idle
    await tabA.bringToFront();
    await tabA.waitForTimeout(2000);

    // Ensure A's window is focused before sending force-idle from extension context
    await forceInactivityCheck(settingsPage);
    await tabA.waitForURL(IntentionPage.regex);

    // Focus B window - should show intention page (stale)
    await tabB.bringToFront();
    await expect(tabB).toHaveURL(IntentionPage.regex);

    await context.close();
  });

  test('test-22: two windows, keep active in A, focus B should not show intention', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 1000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    // Window A with scoped tab
    const tabA = await context.newPage();
    await gotoRobust(tabA, AudioTestPage.url);
    await IntentionPage.complete(tabA, testPhrase);

    // Window B with scoped tab (same scope) - create as separate window
    const tabB = await createNewWindowFromTab(tabA, AudioTestPage.url);
    await IntentionPage.complete(tabB, testPhrase);

    // Keep active for over timeout duration in A
    await tabA.bringToFront();
    await tabA.waitForTimeout(1500);

    // Focus B - should NOT show intention page
    await tabB.bringToFront();
    await expect(tabB).toHaveURL(AudioTestPage.regex);

    await context.close();
  });

  test('test-23: complex multi-window scenario with window close', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 2000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    await toggleOsIdleEnabled(settingsPage, false);

    // Window A with tabs a (scoped) and a' (non-scoped)
    const tabA = await context.newPage();
    await gotoRobust(tabA, AudioTestPage.url);
    await IntentionPage.complete(tabA, testPhrase);
    const tabAPrime = await context.newPage();
    await gotoRobust(tabAPrime, 'https://google.com');

    // Window B with tab b (scoped, same scope as a) - create as separate window
    const tabB = await createNewWindowFromTab(tabA, AudioTestPage.url);
    await IntentionPage.complete(tabB, testPhrase);

    // Focus on b, then close window B
    await tabB.bringToFront();
    await tabB.close();

    // Wait 1s
    await settingsPage.waitForTimeout(1000);

    // Switch to a'
    await tabAPrime.bringToFront();

    // Wait 6s (total 2.2s > 2s timeout)
    await settingsPage.waitForTimeout(1200);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Switch to a - should show intention page
    await tabA.bringToFront();
    await expect(tabA).toHaveURL(IntentionPage.regex);

    await context.close();
  });

  test('test-24: long OS idle should trigger intention page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 15000,
      inactivityMode: 'all',
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AudioTestPage.url);
    await IntentionPage.complete(tab, testPhrase);

    // Ensure system is truly idle by jiggling mouse slightly
    execSync('xdotool mousemove_relative 1 0'); // small jiggle

    await tab.waitForTimeout(16000);

    await expect(tab).toHaveURL(IntentionPage.regex);

    await context.close();
  });

  test('test-25: add intention after opening tab, then focus after timeout shows intention page', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();

    // Configure inactivity first (no intention yet)
    const { settingsPage } = await openSettingsPage(context, {
      e2eInactivityTimeoutMs: 2000,
    });
    const advancedToggle = settingsPage.getByTestId('advanced-settings-toggle');
    await advancedToggle.waitFor({ state: 'visible' });
    await advancedToggle.scrollIntoViewIfNeeded();
    await advancedToggle.click();
    await settingsPage.getByTestId('inactivity-mode-all').click();

    // Open first tab (non-scoped initially)
    const tab1 = await context.newPage();
    await gotoRobust(tab1, AudioTestPage.url);

    // Now add intention in settings to make it scoped
    await settingsPage.bringToFront();
    await SettingsPage.addIntention(settingsPage, {
      url: AudioTestPage.domain,
      phrase:
        'test-25: add intention after opening tab, then focus after timeout shows intention page',
    });

    // Open second tab (non-scoped)
    const tab2 = await context.newPage();
    await gotoRobust(tab2, 'https://example.com');

    // Wait past timeout (2.5s > 2s timeout)
    await settingsPage.waitForTimeout(2500);

    // Force inactivity check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Go to first tab - should show intention page
    await tab1.bringToFront();
    await expect(tab1).toHaveURL(IntentionPage.regex);

    await context.close();
  });
});
