import { expect, Page, test } from '@playwright/test';
import {
  launchExtension,
  openSettingsPage,
  waitForSyncStorageChange,
} from './utils/extension';

test.describe.configure({ mode: 'parallel' });

async function startAudioPlayback(page: Page): Promise<void> {
  // Navigate to the first-party audio fixture
  await page.goto('https://jonathanmoregard.github.io/intender/test/assets/');

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

async function setupInactivityAndIntention(context: any, timeoutMs: number) {
  const { page: options } = await openSettingsPage(context, {
    e2eInactivityTimeoutMs: timeoutMs,
  });

  const advancedToggle = options.getByTestId('advanced-settings-toggle');
  await advancedToggle.waitFor({ state: 'visible' });
  await advancedToggle.scrollIntoViewIfNeeded();
  await advancedToggle.click();

  await options.getByTestId('inactivity-mode-all').click();

  const storageVals = await options.evaluate(async () => {
    // @ts-ignore
    const s = await chrome.storage.sync.get();
    return {
      inactivityMode: s.inactivityMode,
      inactivityTimeoutMs: s.inactivityTimeoutMs,
    };
  });
  expect(storageVals.inactivityMode).toBe('all');
  expect(storageVals.inactivityTimeoutMs).toBe(timeoutMs);

  const urlInput = options.locator('input.url-input').first();
  const phraseInput = options.locator('textarea.phrase-input').first();
  await urlInput.fill('jonathanmoregard.github.io');
  await phraseInput.fill('Hello Intent');

  await waitForSyncStorageChange(options, ['intentions']);
  await options.getByRole('button', { name: 'Save changes' }).click();
  await options.waitForTimeout(300);

  return { options };
}

async function openAndCompleteIntention(context: any) {
  const target: Page = await context.newPage();
  try {
    await target.goto(
      'https://jonathanmoregard.github.io/intender/test/assets/',
      { waitUntil: 'domcontentloaded' }
    );
  } catch {}
  await expect(target).toHaveURL(
    /chrome-extension:\/\/.+\/intention-page\.html\?target=/
  );

  await target.locator('#phrase').fill('Hello Intent');
  const goButton = target.locator('#go');
  await Promise.all([
    target.waitForNavigation({
      url: /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//,
    }),
    goButton.click(),
  ]);
  return target;
}

async function forceInactivityCheck(optionsPage: Page) {
  await optionsPage.evaluate(() => {
    // @ts-ignore
    chrome.runtime.sendMessage({ type: 'e2e:forceInactivityCheck-idle' });
  });
}

test.describe('Inactivity revalidation', () => {
  test('focus-switch: timeout in ms and revalidation on tab focus after inactivity', async () => {
    const { context } = await launchExtension();
    const { options } = await setupInactivityAndIntention(context, 3000);
    const target = await openAndCompleteIntention(context);

    const other = await context.newPage();
    await other.goto('about:blank');
    await options.waitForTimeout(3500);

    await target.bringToFront();
    await expect(target).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  test('same-tab: revalidates without tab switch after inactivity', async () => {
    const { context } = await launchExtension();
    const { options } = await setupInactivityAndIntention(context, 15000);
    const target = await openAndCompleteIntention(context);

    await target.waitForTimeout(15500);
    await forceInactivityCheck(options);

    await expect(target).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  test('sound: same-scope tab with audio should bypass inactivity revalidation', async () => {
    const { context } = await launchExtension();
    const { options } = await setupInactivityAndIntention(context, 3000);
    // Switch to mode all-except-audio
    await options.getByTestId('inactivity-mode-all-except-audio').click();
    await options.waitForTimeout(200);

    const target = await openAndCompleteIntention(context);

    // Open another tab with the same fixture (same scope) with audio and start playback
    const audioTab = await context.newPage();
    await startAudioPlayback(audioTab);

    // Wait beyond inactivity
    await options.waitForTimeout(3500);

    // Bring target tab to front, should NOT redirect due to audible exemption in same scope
    await target.bringToFront();
    await expect(target).toHaveURL(
      /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//
    );

    await context.close();
  });

  test('sound: active tab with audio should not revalidate while passively listening', async () => {
    const { context } = await launchExtension();
    const { options } = await setupInactivityAndIntention(context, 3000);
    // all-except-audio mode
    await options.getByTestId('inactivity-mode-all-except-audio').click();
    await options.waitForTimeout(200);

    // Open an audio tab and start playback
    const audioTab = await context.newPage();
    await startAudioPlayback(audioTab);

    // Stay on audio tab and wait beyond inactivity
    await audioTab.waitForTimeout(3500);
    // No redirect expected
    await expect(audioTab).not.toHaveURL(/chrome-extension:\/\//);

    await context.close();
  });
});
