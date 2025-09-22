import type { Page } from '@playwright/test';
import { IntentionPage } from './fixtures/page/intention';
import { SettingsPage } from './fixtures/page/settings';
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
    await SettingsPage.addIntention(settingsPage, {
      url: 'facebook.se',
      phrase: 'I want to check social media',
    });

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
    await expect(page).toHaveURL(IntentionPage.regex);
    await expect(
      page.locator('text=I want to check social media')
    ).toBeVisible();

    await context.close();
  });

  test('redirected URL should trigger intention page', async () => {
    const { context } = await launchExtension();

    // Open settings page
    const { settingsPage } = await openSettingsPage(context);

    await settingsPage.waitForLoadState('networkidle');

    // Add intention for facebook.com (target of redirect)
    await SettingsPage.addIntention(settingsPage, {
      url: 'facebook.com',
      phrase: 'I want to test redirect behavior',
    });

    // Navigate to faceboo.com (outside intention scope)
    // that redirects to facebook.com (inside intention scope)
    const page: Page = await context.newPage();
    try {
      await page.goto('https://faceboo.com', { waitUntil: 'domcontentloaded' });
    } catch {
      // Navigation aborted due to extension redirect is expected
    }

    // Should land on intention page (even though original was a redirect)
    await expect(page).toHaveURL(IntentionPage.regex);
    await expect(
      page.locator('text=I want to test redirect behavior')
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
    await SettingsPage.addIntention(settingsPage, {
      url: 'facebook.com',
      phrase: 'I want to check social media',
    });

    // Navigate to facebook.se to test matching
    const page: Page = await context.newPage();
    try {
      await page.goto('https://facebook.se', { waitUntil: 'domcontentloaded' });
    } catch {
      // Navigation aborted due to extension redirect is expected
    }

    // Should show intention page (pause page)
    await expect(page).toHaveURL(IntentionPage.regex);
    await expect(
      page.locator('text=I want to check social media')
    ).toBeVisible();

    await context.close();
  });
});
