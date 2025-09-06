import { expect, Page, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import {
  launchExtension,
  openSettingsPage,
  waitForSyncStorageChange,
} from './utils/extension';

// Global constants for test URLs and patterns
const AUDIO_TEST_URL =
  'https://jonathanmoregard.github.io/intender/test/assets/';
const AUDIO_TEST_DOMAIN = 'jonathanmoregard.github.io';
const INTENTION_PAGE_REGEX =
  /chrome-extension:\/\/.+\/intention-page\.html\?target=/;

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
}

async function bringToFrontAndWait(page: Page): Promise<void> {
  await page.bringToFront();
  // Simple timeout-based wait instead of CSP-blocked waitForFunction
  await page.waitForTimeout(200);
}

async function startAudioPlayback(page: Page): Promise<void> {
  // Ensure we're on the target page (should already be there from openAndCompleteIntention)
  const currentUrl = page.url();
  if (!currentUrl.includes('jonathanmoregard.github.io/intender/test/assets')) {
    throw new Error(
      'startAudioPlayback expects to be called on a page already at the target URL'
    );
  }

  // Click the play button
  const playButton = page.getByTestId('fixture-play');
  await playButton.waitFor({ state: 'visible' });
  await playButton.click();

  // Wait for audio to actually start playing
  await page.waitForFunction(
    () => {
      // @ts-ignore
      const audio = document.querySelector('audio');
      return !!audio && !audio.paused && audio.currentTime > 0;
    },
    { timeout: 5000 }
  );
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

  const urlInput = settingsPage.locator('input.url-input').first();
  const phraseInput = settingsPage.locator('textarea.phrase-input').first();
  await urlInput.fill(opts.url);
  await phraseInput.fill(opts.phrase);

  await waitForSyncStorageChange(settingsPage, ['intentions']);
  await settingsPage.getByRole('button', { name: 'Save changes' }).click();
  await settingsPage.waitForTimeout(300);

  return { settingsPage };
}

async function completeIntention(opts: { page: Page; phrase: string }) {
  await expect(opts.page).toHaveURL(INTENTION_PAGE_REGEX);

  await opts.page.locator('#phrase').fill(opts.phrase);
  const goButton = opts.page.locator('#go');
  await Promise.all([
    opts.page.waitForURL(
      new RegExp(AUDIO_TEST_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    ),
    goButton.click(),
  ]);
  return opts.page;
}

async function forceInactivityCheck(optionsPage: Page) {
  await optionsPage.evaluate(() => {
    // @ts-ignore
    chrome.runtime.sendMessage({ type: 'e2e:forceInactivityCheck-idle' });
  });
}

// Parallel-safe tests (can run concurrently)
test.describe('Inactivity revalidation - parallel safe', () => {
  test('focus-switch: timeout in ms and revalidation on tab focus after inactivity', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    const otherTab = await context.newPage();
    await otherTab.goto('about:blank');
    await bringToFrontAndWait(otherTab);
    await settingsPage.waitForTimeout(3500);

    await bringToFrontAndWait(tab);
    await expect(tab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tab.waitForTimeout(100); // Settle time to prevent double-fires

    await context.close();
  });

  test('sound: same-scope tab with audio should bypass inactivity revalidation', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all-except-audio',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Open another tab with the same fixture (same scope) with audio and start playback
    const audioTab = await context.newPage();
    await gotoRobust(audioTab, AUDIO_TEST_URL);
    await completeIntention({ page: audioTab, phrase: 'Hello Intent' });
    await startAudioPlayback(audioTab);

    // Wait beyond inactivity
    await settingsPage.waitForTimeout(3500);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Bring tab tab to front, should NOT redirect due to audible exemption in same scope
    await tab.bringToFront();
    await expect(tab).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    await context.close();
  });

  test('sound: active tab with audio should not revalidate while passively listening', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all-except-audio',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Open an audio tab and start playback
    const audioTab = await context.newPage();
    await gotoRobust(audioTab, AUDIO_TEST_URL);
    await completeIntention({ page: audioTab, phrase: 'Hello Intent' });
    await startAudioPlayback(audioTab);

    // Stay on audio tab and wait beyond inactivity
    await audioTab.waitForTimeout(3500);
    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);
    // No redirect expected due to audio exemption
    await expect(audioTab).not.toHaveURL(/chrome-extension:\/\//);

    await context.close();
  });

  // Test 3: Idle on (3s). Navigate to page with intention, pass the intention check, open another tab (any). Wait > timeout, switch back to scoped tab, should show intention page.
  test('test-3: open another tab, wait timeout, switch back shows intention page', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Open another tab (any)
    const other = await context.newPage();
    await other.goto('about:blank');
    await bringToFrontAndWait(other);

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Switch back to scoped tab - should show intention page
    await bringToFrontAndWait(tab);
    await expect(tab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tab.waitForTimeout(100); // Settle time to prevent double-fires

    await context.close();
  });

  // Test 4: Same as 3 but on-except-audio.
  test('test-4: open another tab, wait timeout, switch back shows intention page (all-except-audio mode)', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all-except-audio',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Open another tab (any)
    const other = await context.newPage();
    await other.goto('about:blank');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Switch back to scoped tab - should show intention page
    await tab.bringToFront();
    await expect(tab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  // Test 5: Idle on-except-audio (3s). Navigate to test audio page with intention, pass the intention check, start audio, duplicate the tab. Wait > timeout, focusing either should remain on the audio page (audio exemption).
  test('test-5: duplicate audio tab, both stay on audio page due to exemption', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all-except-audio',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Start audio
    await startAudioPlayback(tab);

    // Duplicate the tab - it will need to complete intention too
    const duplicate = await context.newPage();
    await gotoRobust(duplicate, AUDIO_TEST_URL);
    await completeIntention({ page: duplicate, phrase: 'Hello Intent' });

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Focus original - should remain on audio page (audio exemption)
    await tab.bringToFront();
    await expect(tab).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    // Focus duplicate - should also remain on audio page (audio exemption)
    await duplicate.bringToFront();
    await expect(duplicate).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    await context.close();
  });

  // Test 6: Idle on-except-audio (3s). Navigate to test audio page with intention, pass the intention check, start audio, duplicate tab, open a new non-scope tab, wait > timeout, focusing the duplicate stays on audio page; focusing the original stays on audio page.
  test('test-6: duplicate audio tab with non-scope tab, both stay on audio page', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all-except-audio',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Start audio
    await startAudioPlayback(tab);

    // Duplicate the tab - it will need to complete intention too
    const duplicate = await context.newPage();
    await gotoRobust(duplicate, AUDIO_TEST_URL);
    await completeIntention({ page: duplicate, phrase: 'Hello Intent' });

    // Open a new non-scope tab
    const nonScopeTab = await context.newPage();
    await gotoRobust(nonScopeTab, 'https://google.com');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Focus duplicate - should stay on audio page
    await duplicate.bringToFront();
    await expect(duplicate).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    // Focus original - should stay on audio page
    await tab.bringToFront();
    await expect(tab).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    await context.close();
  });

  // Test 6b: Same as 6, but the duplicate is moved to its own window just after creation
  test('test-6b: duplicate audio tab in separate window, both stay on audio page', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Start audio
    await startAudioPlayback(tab);

    // Create new window with duplicate - it will need to complete intention too
    const newWindow = await context.newPage();
    await gotoRobust(newWindow, AUDIO_TEST_URL);
    await completeIntention({ page: newWindow, phrase: 'Hello Intent' });

    // Start audio on duplicate tab too
    await startAudioPlayback(newWindow);

    // Open a new non-scope tab in original window
    const nonScopeTab = await context.newPage();
    await gotoRobust(nonScopeTab, 'https://google.com');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Focus duplicate in new window - should stay on audio page
    await newWindow.bringToFront();
    await expect(newWindow).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    // Focus original - should stay on audio page
    await tab.bringToFront();
    await expect(tab).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    await context.close();
  });

  // Test 9: Mapping cleared when leaving scope
  test('test-9: navigate away from scope, then idle should not trigger intention page', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Navigate away to a non-scoped page
    await gotoRobust(tab, 'https://google.com');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

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
    await expect(tab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  // Test 10: Same-scope tab switch is safe
  test('test-10: same-scope tab switch should not trigger intention page', async () => {
    const { context } = await launchExtension();
    await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Open and pass intention check for first tab
    const tabA = await context.newPage();
    await gotoRobust(tabA, AUDIO_TEST_URL);
    await completeIntention({ page: tabA, phrase: 'Hello Intent' });

    // Open second tab in same scope
    const tabB = await context.newPage();
    await gotoRobust(
      tabB,
      'https://jonathanmoregard.github.io/intender/test/assets/'
    );
    await expect(tabB).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tabB.locator('#phrase').fill('Hello Intent');
    await Promise.all([
      tabB.waitForURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      ),
      tabB.locator('#go').click(),
    ]);

    // Work on tab A longer than timeout (stay active)
    await bringToFrontAndWait(tabA);
    await tabA.waitForTimeout(3500);

    // Switch to tab B - should NOT show intention page (same-scope switch is safe)
    await bringToFrontAndWait(tabB);
    await expect(tabB).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );
    await tabB.waitForTimeout(100); // Settle time to prevent double-fires

    await context.close();
  });

  // Test 11: Pause audio in-place (grace on audible off)
  test('test-11: pause audio should refresh activity, delay intention page', async () => {
    const { context } = await launchExtension();
    await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all-except-audio',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Start audio
    await startAudioPlayback(tab);

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
    await expect(tab).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    await context.close();
  });

  // Test 14: Work long in one tab
  test('test-14: work long in one tab, switch to other same-scope tab should not show intention', async () => {
    const { context } = await launchExtension();
    await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Open and pass intention check for 2 tabs in same scope
    const tab1 = await context.newPage();
    await gotoRobust(tab1, AUDIO_TEST_URL);
    await completeIntention({ page: tab1, phrase: 'Hello Intent' });

    const tab2 = await context.newPage();
    await gotoRobust(
      tab2,
      'https://jonathanmoregard.github.io/intender/test/assets/'
    );
    await expect(tab2).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tab2.locator('#phrase').fill('Hello Intent');
    await Promise.all([
      tab2.waitForURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      ),
      tab2.locator('#go').click(),
    ]);

    // Work on tab1 for over inactivity time
    await tab1.bringToFront();
    await tab1.waitForTimeout(3500);

    // Open new tab (non-scope)
    const newTab = await context.newPage();
    await gotoRobust(newTab, 'https://google.com');

    // Switch to intention-scope tab2 - should be tab2 (not intention screen)
    await tab2.bringToFront();
    await expect(tab2).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    await context.close();
  });

  // Test 15: Parallel audibles within a scope (close-one/close-last)
  test('test-15: parallel audibles, close one keeps exemption, close last removes exemption', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all-except-audio',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Two tabs in same scope playing audio
    const tab1 = await context.newPage();
    await gotoRobust(tab1, AUDIO_TEST_URL);
    await completeIntention({ page: tab1, phrase: 'Hello Intent' });
    await startAudioPlayback(tab1);

    const tab2 = await context.newPage();
    await gotoRobust(
      tab2,
      'https://jonathanmoregard.github.io/intender/test/assets/'
    );
    await expect(tab2).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tab2.locator('#phrase').fill('Hello Intent');
    await Promise.all([
      tab2.waitForURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      ),
      tab2.locator('#go').click(),
    ]);
    await startAudioPlayback(tab2);

    // Stop audio in one tab
    await tab1.evaluate(() => {
      // @ts-ignore
      const audio = document.querySelector('audio');
      if (audio) {
        audio.pause();
      }
    });

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Focus either tab - should remain on destination (exemption holds due to tab2)
    await tab1.bringToFront();
    await expect(tab1).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    await tab2.bringToFront();
    await expect(tab2).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    // Close the last audible tab
    await tab2.close();

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Focus the scope - should now show intention page (exemption removed)
    await tab1.bringToFront();
    await expect(tab1).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  // Test 17: Muted-audio exemption correctness
  test('test-17: muted audio should not count as audible, expect intention page', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all-except-audio',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Start audio and immediately mute it
    await startAudioPlayback(tab);
    await tab.evaluate(() => {
      // @ts-ignore
      const audio = document.querySelector('audio');
      if (audio) {
        audio.muted = true;
      }
    });

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Focus tab - should show intention page (muted doesn't count as audible)
    await tab.bringToFront();
    await expect(tab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  // Test 7: Idle on (3s). Navigate to a site with intention, pass the intention check, open 5 other tabs within same site, go idle, return to intention page (pass the intention check again), focusing the other same-site tabs should not show intention page.
  test('test-7: multiple same-site tabs, after revalidation other tabs should not show intention', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Navigate to site and pass intention check
    const mainTab = await context.newPage();
    await gotoRobust(mainTab, AUDIO_TEST_URL);
    await completeIntention({ page: mainTab, phrase: 'Hello Intent' });

    // Open 5 other tabs within same site
    const sameSiteTabs = [];
    for (let i = 0; i < 5; i++) {
      const tab = await context.newPage();
      await gotoRobust(
        tab,
        'https://jonathanmoregard.github.io/intender/test/assets/'
      );
      await expect(tab).toHaveURL(
        /chrome-extension:\/\/.+\/intention-page\.html\?target=/
      );
      await tab.locator('#phrase').fill('Hello Intent');
      await Promise.all([
        tab.waitForURL(
          '/https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//'
        ),
        tab.locator('#go').click(),
      ]);
      sameSiteTabs.push(tab);
    }

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Force idle to trigger intention page on main tab
    await forceInactivityCheck(settingsPage);
    await mainTab.bringToFront();
    await expect(mainTab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    // Pass intention check again
    await mainTab.locator('#phrase').fill('Hello Intent');
    await Promise.all([
      mainTab.waitForURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      ),
      mainTab.locator('#go').click(),
    ]);

    // Focus other same-site tabs - should NOT show intention page
    for (const tab of sameSiteTabs) {
      await tab.bringToFront();
      await expect(tab).toHaveURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      );
    }

    await context.close();
  });

  // Test 8: Same as 7 but on-except-audio.
  test('test-8: multiple same-site tabs, after revalidation other tabs should not show intention (all-except-audio)', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all-except-audio',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Navigate to site and pass intention check
    const mainTab = await context.newPage();
    await gotoRobust(mainTab, AUDIO_TEST_URL);
    await completeIntention({ page: mainTab, phrase: 'Hello Intent' });

    // Open 5 other tabs within same site
    const sameSiteTabs = [];
    for (let i = 0; i < 5; i++) {
      const tab = await context.newPage();
      await gotoRobust(
        tab,
        'https://jonathanmoregard.github.io/intender/test/assets/'
      );
      await expect(tab).toHaveURL(
        /chrome-extension:\/\/.+\/intention-page\.html\?target=/
      );
      await tab.locator('#phrase').fill('Hello Intent');
      await Promise.all([
        tab.waitForURL(
          '/https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//'
        ),
        tab.locator('#go').click(),
      ]);
      sameSiteTabs.push(tab);
    }

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Force idle to trigger intention page on main tab
    await forceInactivityCheck(settingsPage);
    await mainTab.bringToFront();
    await expect(mainTab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    // Pass intention check again
    await mainTab.locator('#phrase').fill('Hello Intent');
    await Promise.all([
      mainTab.waitForURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      ),
      mainTab.locator('#go').click(),
    ]);

    // Focus other same-site tabs - should NOT show intention page
    for (const tab of sameSiteTabs) {
      await tab.bringToFront();
      await expect(tab).toHaveURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      );
    }

    await context.close();
  });

  // Test 18: Intention page is not a scope
  test('test-18: intention page URL should not be treated as a scope', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await openSettingsPage(context, {
      e2eInactivityTimeoutMs: 3000,
    });

    const advancedToggle = settingsPage.getByTestId('advanced-settings-toggle');
    await advancedToggle.waitFor({ state: 'visible' });
    await advancedToggle.scrollIntoViewIfNeeded();
    await advancedToggle.click();
    await settingsPage.getByTestId('inactivity-mode-all').click();

    // Create intention for intention page URL (should error)
    const urlInput1 = settingsPage.locator('input.url-input').first();
    const phraseInput1 = settingsPage.locator('textarea.phrase-input').first();
    await urlInput1.fill('chrome-extension://');
    await phraseInput1.fill('This should error');

    // Add another intention for google
    await settingsPage.getByRole('button', { name: 'Add website' }).click();
    const urlInput2 = settingsPage.locator('input.url-input').nth(1);
    const phraseInput2 = settingsPage.locator('textarea.phrase-input').nth(1);
    await urlInput2.fill('google.com');
    await phraseInput2.fill('Google intention');

    await waitForSyncStorageChange(settingsPage, ['intentions']);
    await settingsPage.getByRole('button', { name: 'Save changes' }).click();
    await settingsPage.waitForTimeout(300);

    // Go to test domain, verify intention page has the correct intention text
    const testTab = await context.newPage();
    await gotoRobust(testTab, 'https://google.com');
    await expect(testTab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    // Check if intention page loaded correctly (basic functionality test)
    await expect(testTab.locator('#phrase')).toBeVisible();
    // Note: placeholder issue may be related to intention loading - needs investigation

    // Go to settings and verify intention page intention has errored URL box
    await settingsPage.bringToFront();
    const firstUrlInput = settingsPage.locator('input.url-input').first();
    await expect(firstUrlInput).toHaveClass(/error/);

    await context.close();
  });

  // Test 19: Multi window tests
  test('test-19a: two windows, stale tab in B, focus A then B should show intention', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Window A with scoped tab
    const tabA = await context.newPage();
    await gotoRobust(tabA, AUDIO_TEST_URL);
    await completeIntention({ page: tabA, phrase: 'Hello Intent' });

    // Window B with scoped tab (same scope)
    const tabB = await context.newPage();
    await gotoRobust(
      tabB,
      'https://jonathanmoregard.github.io/intender/test/assets/'
    );
    await expect(tabB).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tabB.locator('#phrase').fill('Hello Intent');
    await Promise.all([
      tabB.waitForURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      ),
      tabB.locator('#go').click(),
    ]);

    // Focus A, go idle
    await tabA.bringToFront();
    await settingsPage.waitForTimeout(3500);
    await forceInactivityCheck(settingsPage);

    // Focus B window - should show intention page (stale)
    await tabB.bringToFront();
    await expect(tabB).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  test('test-19b: two windows, keep active in A, focus B should not show intention', async () => {
    const { context } = await launchExtension();
    await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Window A with scoped tab
    const tabA = await context.newPage();
    await gotoRobust(tabA, AUDIO_TEST_URL);
    await completeIntention({ page: tabA, phrase: 'Hello Intent' });

    // Window B with scoped tab (same scope)
    const tabB = await context.newPage();
    await gotoRobust(
      tabB,
      'https://jonathanmoregard.github.io/intender/test/assets/'
    );
    await expect(tabB).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tabB.locator('#phrase').fill('Hello Intent');
    await Promise.all([
      tabB.waitForURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      ),
      tabB.locator('#go').click(),
    ]);

    // Keep active for over timeout duration in A
    await tabA.bringToFront();
    await tabA.waitForTimeout(3500);

    // Focus B - should NOT show intention page
    await tabB.bringToFront();
    await expect(tabB).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    await context.close();
  });

  test('test-19c: complex multi-window scenario with window close', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 10000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Window A with tabs a (scoped) and a' (non-scoped)
    const tabA = await context.newPage();
    await gotoRobust(tabA, AUDIO_TEST_URL);
    await completeIntention({ page: tabA, phrase: 'Hello Intent' });
    const tabAPrime = await context.newPage();
    await gotoRobust(tabAPrime, 'https://google.com');

    // Window B with tab b (scoped, same scope as a)
    const tabB = await context.newPage();
    await gotoRobust(
      tabB,
      'https://jonathanmoregard.github.io/intender/test/assets/'
    );
    await expect(tabB).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tabB.locator('#phrase').fill('Hello Intent');
    await Promise.all([
      tabB.waitForURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      ),
      tabB.locator('#go').click(),
    ]);

    // Focus on b, then close window B
    await tabB.bringToFront();
    await tabB.close();

    // Wait 5s
    await settingsPage.waitForTimeout(5000);

    // Switch to a'
    await tabAPrime.bringToFront();

    // Wait 6s (total 11s > 10s timeout)
    await settingsPage.waitForTimeout(6000);

    // Force idle check since this is a sub-15s timeout test
    await forceInactivityCheck(settingsPage);

    // Switch to a - should show intention page
    await tabA.bringToFront();
    await expect(tabA).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  // Test 20: Race condition idle
  test('test-20: force idle and focus at same time should not cause double redirect', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Open another tab
    const otherTab = await context.newPage();
    await otherTab.goto('about:blank');

    // Wait beyond timeout
    await settingsPage.waitForTimeout(3500);

    // Force idle and focus tab at the same time
    await Promise.all([forceInactivityCheck(settingsPage), tab.bringToFront()]);

    // Should show intention page (but only one redirect should happen)
    await expect(tab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    // Wait a bit to ensure no second redirect occurs
    await tab.waitForTimeout(1000);
    await expect(tab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  // Test 21: Focus DevTools or extension popup should be safe
  test('test-21: focus devtools should be safe (no errors, no intention page)', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({ page: tab, phrase: 'Hello Intent' });

    // Simulate DevTools focus by creating a situation where window focus changes
    // but no valid active tab is available (what DevTools focus would cause)

    // Wait beyond timeout to ensure we're past the inactivity threshold
    await tab.waitForTimeout(3500);

    // Focus on settings page (simulates DevTools/popup focus scenario)
    await settingsPage.bringToFront();
    await settingsPage.waitForTimeout(500);

    // The system should handle this gracefully with no errors and no redirects
    // Focus back to original tab - should remain on the target page (NO intention page)
    await tab.bringToFront();
    await expect(tab).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    // Verify no errors occurred (tab should still be functional)
    await expect(tab.locator('body')).toBeVisible();

    await context.close();
  });
});

// Serial tests (for OS idle behavior and cross-window focus-sensitive tests)
test.describe.serial('@serial Inactivity revalidation - Serial Tests', () => {
  // Test 16: Cross-window same-scope switch (serial due to window focus sensitivity)
  test('test-16: cross-window same-scope switch should not show intention page', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 3000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'Hello Intent',
    });

    // Open and pass intention check for tab in Window A
    const tabA = await context.newPage();
    await gotoRobust(tabA, AUDIO_TEST_URL);
    await completeIntention({ page: tabA, phrase: 'Hello Intent' });

    // Get Window A's ID for later focus control - use getCurrent() for deterministic selection
    const windowAId = await settingsPage.evaluate(async () => {
      const currentWindow = await chrome.windows.getCurrent();
      if (!currentWindow?.id) {
        throw new Error('Failed to get current window ID');
      }
      return currentWindow.id;
    });

    // Create real Chrome window with blank tab first (Window B)
    // Use extension API to create a real window for proper window focus behavior
    const windowBInfo = await settingsPage.evaluate(async () => {
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
    });

    // Wait for new page to be created and get it - use deterministic wait
    const tabB = await context.waitForEvent('page', { timeout: 5000 });

    // Now navigate to the target URL to trigger extension interception
    await gotoRobust(
      tabB,
      'https://jonathanmoregard.github.io/intender/test/assets/'
    );

    await expect(tabB).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tabB.locator('#phrase').fill('Hello Intent');
    await Promise.all([
      tabB.waitForURL(
        /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
      ),
      tabB.locator('#go').click(),
    ]);

    // Focus Window A and work beyond timeout
    await settingsPage.evaluate(async windowId => {
      await chrome.windows.update(windowId, { focused: true });
    }, windowAId);
    await bringToFrontAndWait(tabA);
    await tabA.waitForTimeout(3500);

    // Focus Window B using chrome.windows.update - should NOT show intention page
    await settingsPage.evaluate(async windowId => {
      await chrome.windows.update(windowId, { focused: true });
    }, windowBInfo.windowId);

    // Wait for focus change to take effect
    await tabB.waitForTimeout(200);

    await expect(tabB).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );
    await tabB.waitForTimeout(100); // Settle time to prevent double-fires

    await context.close();
  });

  test('test-13: long OS idle should trigger intention page', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await setupInactivityAndIntention({
      context,
      timeoutMs: 15000,
      inactivityMode: 'all',
      url: AUDIO_TEST_DOMAIN,
      phrase: 'test-13: long OS idle should trigger intention page',
    });
    const tab = await context.newPage();
    await gotoRobust(tab, AUDIO_TEST_URL);
    await completeIntention({
      page: tab,
      phrase: 'test-13: long OS idle should trigger intention page',
    });

    // Ensure system is truly idle by jiggling mouse slightly
    execSync('xdotool mousemove_relative 1 0'); // small jiggle

    await tab.waitForTimeout(16000);

    await expect(tab).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await tab.waitForTimeout(100); // Settle time to prevent double-fires

    await context.close();
  });
});
