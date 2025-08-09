import { expect, Page, test } from '@playwright/test';
import {
  launchExtension,
  openSettingsPage,
  waitForSyncStorageChange,
} from './utils/extension';

test.describe.configure({ mode: 'parallel' });

async function seedYouTubeConsentCookies(context: any): Promise<void> {
  await context.addCookies([
    {
      name: 'CONSENT',
      value: 'YES+1',
      domain: '.youtube.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'CONSENT',
      value: 'YES+1',
      domain: '.google.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
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
  await urlInput.fill('google.com');
  await phraseInput.fill('Hello Intent');

  await waitForSyncStorageChange(options, ['intentions']);
  await options.getByRole('button', { name: 'Save changes' }).click();
  await options.waitForTimeout(300);

  return { options };
}

async function openAndCompleteIntention(context: any) {
  const target: Page = await context.newPage();
  try {
    await target.goto('https://google.com', { waitUntil: 'domcontentloaded' });
  } catch {}
  await expect(target).toHaveURL(
    /chrome-extension:\/\/.+\/intention-page\.html\?target=/
  );

  await target.locator('#phrase').fill('Hello Intent');
  const goButton = target.locator('#go');
  await Promise.all([
    target.waitForNavigation({ url: /https:\/\/www\.google\.com\/?/ }),
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

async function startYouTubePlayback(page: Page): Promise<void> {
  const first = page.locator('ytd-video-renderer #video-title').first();
  await first.waitFor({ state: 'visible', timeout: 10000 });
  await first.click();

  await page.waitForFunction(
    () => {
      // @ts-ignore
      return !!document.querySelector('video');
    },
    { timeout: 10000 }
  );

  await page.evaluate(() => {
    // @ts-ignore
    const v = document.querySelector('video');
    if (v) {
      v.muted = false;
      v.volume = 0.1;
      const p = v.play?.();
      if (p && typeof p.then === 'function') p.catch(() => {});
    }
  });

  try {
    await page.keyboard.press('k');
  } catch {}
  try {
    await page.keyboard.press('m');
  } catch {}

  await page.waitForFunction(
    () => {
      // @ts-ignore
      const v = document.querySelector('video');
      return !!v && v.readyState >= 2 && !v.paused;
    },
    { timeout: 10000 }
  );
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
    const { options } = await setupInactivityAndIntention(context, 3000);
    const target = await openAndCompleteIntention(context);

    await target.waitForTimeout(3500);
    await forceInactivityCheck(options);

    await expect(target).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });

  test('sound: other tab with audio should bypass inactivity revalidation', async () => {
    const { context } = await launchExtension();
    const { options } = await setupInactivityAndIntention(context, 3000);
    // Switch to mode all-except-audio
    await options.getByTestId('inactivity-mode-all-except-audio').click();
    await options.waitForTimeout(200);

    const target = await openAndCompleteIntention(context);

    // Pre-seed consent and open a YouTube audio tab and start playback
    await seedYouTubeConsentCookies(context);
    const audioTab = await context.newPage();
    await audioTab.goto(
      'https://www.youtube.com/results?search_query=1+hour+background+music'
    );
    await startYouTubePlayback(audioTab);

    // Wait beyond inactivity
    await options.waitForTimeout(3500);

    // Bring google tab to front, should NOT redirect due to audible exemption
    await target.bringToFront();
    await expect(target).toHaveURL(/https:\/\/www\.google\.com\/?/);

    await context.close();
  });

  test('sound: active tab with audio should not revalidate while passively listening', async () => {
    const { context } = await launchExtension();
    const { options } = await setupInactivityAndIntention(context, 3000);
    // all-except-audio mode
    await options.getByTestId('inactivity-mode-all-except-audio').click();
    await options.waitForTimeout(200);

    // Pre-seed consent and open YouTube in the same tab and start playback
    await seedYouTubeConsentCookies(context);
    const audioTab = await context.newPage();
    await audioTab.goto(
      'https://www.youtube.com/results?search_query=1+hour+background+music'
    );
    await startYouTubePlayback(audioTab);

    // Stay on audio tab and wait beyond inactivity
    await audioTab.waitForTimeout(3500);
    // No redirect expected
    await expect(audioTab).not.toHaveURL(/chrome-extension:\/\//);

    await context.close();
  });
});
