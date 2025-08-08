import { expect, Page, test } from '@playwright/test';
import {
  launchExtension,
  openSettingsPage,
  waitForSyncStorageChange,
} from './utils/extension';

async function getExtensionIdFromContext(context: any): Promise<string> {
  const sw =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  return new URL(sw.url()).host;
}

test.describe('Inactivity revalidation', () => {
  test('timeout in ms and revalidation on tab focus after inactivity', async () => {
    const { context } = await launchExtension();

    // Open options page with e2e timeout override
    const { page: options, extensionId } = await openSettingsPage(context, {
      e2eInactivityTimeoutMs: 3000,
    });

    // Expand advanced settings and enable inactivity
    const advancedToggle = options.getByTestId('advanced-settings-toggle');
    await advancedToggle.waitFor({ state: 'visible' });
    await advancedToggle.scrollIntoViewIfNeeded();
    await advancedToggle.click();

    await options.getByTestId('inactivity-mode-all').click();

    // Verify storage contains expected values
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

    // Open real site that should be intercepted
    const target: Page = await context.newPage();
    try {
      await target.goto('https://google.com', {
        waitUntil: 'domcontentloaded',
      });
    } catch {}

    // Expect intention page
    await expect(target).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    // Complete intention and land on google.com
    const intentionTextarea = target.locator('#phrase');
    await intentionTextarea.fill('Hello Intent');
    const goButton = target.locator('#go');
    await Promise.all([
      target.waitForNavigation({ url: /https:\/\/www\.google\.com\/?/ }),
      goButton.click(),
    ]);

    // Switch focus away (new tab) for > 3s
    const other = await context.newPage();
    await other.goto('about:blank');
    await options.waitForTimeout(3500);

    // Focus back to google tab; should revalidate due to inactivity
    await target.bringToFront();
    await expect(target).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );

    await context.close();
  });
});
