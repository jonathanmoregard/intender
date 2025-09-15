import type { Page } from '@playwright/test';
import { expect, test } from './test-setup';
import { launchExtension, openSettingsPage } from './utils/extension';

test.describe('URL Matching', () => {
  test('facebook.se intention should capture facebook.com', async () => {
    const { context } = await launchExtension();

    // Open settings page
    const { settingsPage } = await openSettingsPage(context);

    // Wait for page to load
    await settingsPage.waitForLoadState('networkidle');

    // Add facebook.se intention
    const urlInput = settingsPage.locator('input.url-input').first();
    const phraseInput = settingsPage.locator('textarea.phrase-input').first();

    // Fill the inputs
    await urlInput.fill('facebook.se');
    await phraseInput.fill('I want to check social media');

    // Wait a bit for validation
    await settingsPage.waitForTimeout(1000);

    // Click save without waiting for storage change
    await settingsPage.getByRole('button', { name: 'Save changes' }).click();

    // Wait for background to pick up intentions
    await settingsPage.waitForTimeout(2000);

    // Verify intention was added by checking the URL input value
    await expect(urlInput).toHaveValue('facebook.se');

    // Navigate to facebook.com to test matching
    const page: Page = await context.newPage();
    try {
      await page.goto('https://facebook.com', {
        waitUntil: 'domcontentloaded',
      });
    } catch {
      // Navigation aborted due to extension redirect is expected
    }

    // Should show intention page (pause page)
    await expect(page).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await expect(
      page.locator('text=I want to check social media')
    ).toBeVisible();

    await context.close();
  });

  test('facebook.com intention should capture facebook.se', async () => {
    const { context } = await launchExtension();

    // Open settings page
    const { settingsPage } = await openSettingsPage(context);

    // Wait for page to load
    await settingsPage.waitForLoadState('networkidle');

    // Add facebook.com intention
    const urlInput = settingsPage.locator('input.url-input').first();
    const phraseInput = settingsPage.locator('textarea.phrase-input').first();
    await urlInput.fill('facebook.com');
    await phraseInput.fill('I want to check social media');

    // Wait a bit for validation
    await settingsPage.waitForTimeout(1000);

    // Click save without waiting for storage change
    await settingsPage.getByRole('button', { name: 'Save changes' }).click();

    // Wait for background to pick up intentions
    await settingsPage.waitForTimeout(2000);

    // Verify intention was added by checking the URL input value
    await expect(urlInput).toHaveValue('facebook.com');

    // Navigate to facebook.se to test matching
    const page: Page = await context.newPage();
    try {
      await page.goto('https://facebook.se', { waitUntil: 'domcontentloaded' });
    } catch {
      // Navigation aborted due to extension redirect is expected
    }

    // Should show intention page (pause page)
    await expect(page).toHaveURL(
      /chrome-extension:\/\/.+\/intention-page\.html\?target=/
    );
    await expect(
      page.locator('text=I want to check social media')
    ).toBeVisible();

    await context.close();
  });
});
