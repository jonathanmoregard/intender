import type { Page } from '@playwright/test';
import { IntentionPage } from './fixtures/page/intention';
import { SettingsPage } from './fixtures/page/settings';
import { expect, test } from './test-setup';
import { launchExtension } from './utils/extension';

test.describe('Reload after intention check', () => {
  test('should stay on site when reloading after completing intention', async () => {
    const testPhrase = 'I want to search for something specific';
    const { context } = await launchExtension();

    // Open settings and add intention
    const settings = await SettingsPage.openSettingsPage(context);
    await SettingsPage.addIntention(settings, {
      url: 'google.com',
      phrase: testPhrase,
    });

    // Navigate to the site
    const page: Page = await context.newPage();
    try {
      await page.goto('https://google.com', { waitUntil: 'domcontentloaded' });
    } catch {
      // Navigation aborted due to redirect is expected
    }

    // Complete the intention
    await expect(page).toHaveURL(IntentionPage.regex);
    await IntentionPage.complete(page, testPhrase);
    await expect(page).toHaveURL(/www\.google\.com\/?/);

    // Reload the page - this should NOT redirect back to intention page
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Verify we're still on google.com, not the intention page
    await expect(page).toHaveURL(/www\.google\.com\/?/);
    await expect(page).not.toHaveURL(IntentionPage.regex);
  });
});
