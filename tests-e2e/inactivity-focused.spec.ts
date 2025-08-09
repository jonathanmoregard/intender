import { expect, Page, test } from '@playwright/test';
import {
  launchExtension,
  openSettingsPage,
  waitForSyncStorageChange,
} from './utils/extension';

// Inactivity revalidation when staying on the same tab (idle->active without tab switch)
// Uses the e2eInactivityTimeoutMs query param to set a short timeout

test.describe('Inactivity revalidation (same tab focus)', () => {
  test('revalidates after idle when user becomes active on same tab', async () => {
    const { context } = await launchExtension();

    // Open options page with 3s override (match other test first steps)
    const { page: options } = await openSettingsPage(context, {
      e2eInactivityTimeoutMs: 3000,
    });

    // Expand advanced settings and enable inactivity
    const advancedToggle = options.getByTestId('advanced-settings-toggle');
    await advancedToggle.waitFor({ state: 'visible' });
    await advancedToggle.scrollIntoViewIfNeeded();
    await advancedToggle.click();

    await options.getByTestId('inactivity-mode-all').click();

    // Verify storage contains expected values (same as other test)
    const storageVals = await options.evaluate(async () => {
      // @ts-ignore
      const s = await chrome.storage.sync.get();
      return {
        inactivityMode: s.inactivityMode,
        inactivityTimeoutMs: s.inactivityTimeoutMs,
      };
    });
    expect(storageVals.inactivityMode).toBe('all');
    expect(storageVals.inactivityTimeoutMs).toBe(3000);

    // Seed a simple intention via the UI so background index picks it up
    const urlInput = options.locator('input.url-input').first();
    const phraseInput = options.locator('textarea.phrase-input').first();
    await urlInput.fill('google.com');
    await phraseInput.fill('Hello Intent');

    await waitForSyncStorageChange(options, ['intentions']);
    await options.getByRole('button', { name: 'Save changes' }).click();
    await options.waitForTimeout(300);

    // Open target site and get redirected to intention page
    const target: Page = await context.newPage();
    try {
      await target.goto('https://google.com', {
        waitUntil: 'domcontentloaded',
      });
    } catch {}
    await expect(target).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    // Complete intention and land on google.com
    await target.locator('#phrase').fill('Hello Intent');
    const goButton = target.locator('#go');
    await Promise.all([
      target.waitForNavigation({ url: /https:\/\/www\.google\.com\/?/ }),
      goButton.click(),
    ]);

    // Remain on same tab; wait just beyond our configured timeout (3s)
    await target.waitForTimeout(3500);
    // Force an inactivity check from extension context (MV3 idle can be flaky under automation)
    await options.evaluate(() => {
      // @ts-ignore
      chrome.runtime.sendMessage({ type: 'e2e:forceInactivityCheck' });
    });

    // Expect revalidation (intention page) to be shown on same tab
    await expect(target).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });
});
