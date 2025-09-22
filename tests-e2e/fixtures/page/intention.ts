import { expect, Page } from '@playwright/test';

export const IntentionPage = {
  domain: 'chrome-extension',
  regex: /chrome-extension:\/\/.+\/intention-page\.html\?target=/,

  async expectLoaded(page: Page): Promise<void> {
    await expect(page.locator('#phrase')).toBeVisible();
  },

  async complete(page: Page, phrase: string): Promise<void> {
    await expect(page).toHaveURL(this.regex);

    // Extract target URL from intention page URL
    const currentUrl = page.url();
    const targetUrl = new URL(currentUrl).searchParams.get('target');
    if (!targetUrl) {
      throw new Error('No target URL found in intention page');
    }

    await page.locator('#phrase').fill(phrase);
    await page.locator('#phrase').press('Enter');

    const target = new URL(targetUrl);
    const baseHost = target.hostname.replace(/^www\./, '');
    const escapedHost = baseHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `^https?:\\/\\/(?:www\\.)?${escapedHost}(?:\\/|$|\\?)`
    );
    await page.waitForURL(regex);
  },
};
