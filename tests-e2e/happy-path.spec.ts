import type { Page } from '@playwright/test';
import { IntentionPage } from './fixtures/page/intention';
import { SettingsPage } from './fixtures/page/settings';
import { expect, test } from './test-setup';
import { launchExtension } from './utils/extension';

// Helper to get current test name with run number
function getTestNameWithRun(): string {
  const testInfo = test.info();
  const testName = testInfo.title;
  const runNumber = testInfo.repeatEachIndex + 1;
  return `${testName} (run ${runNumber})`;
}

test.describe('Happy path intention flow', () => {
  test('test-26: add intention, get intention page, type phrase, and enter', async () => {
    const testPhrase = getTestNameWithRun();
    const { context } = await launchExtension();

    // Open options page
    const options = await SettingsPage.openSettingsPage(context);

    await SettingsPage.addIntention(options, {
      url: 'google.com',
      phrase: testPhrase,
    });

    // Open real site that should be intercepted
    const page: Page = await context.newPage();
    try {
      await page.goto('https://google.com', { waitUntil: 'domcontentloaded' });
    } catch {
      // Navigation aborted due to extension redirect is expected
    }

    // Expect to land on intention page first
    await expect(page).toHaveURL(IntentionPage.regex);

    // Type the exact phrase and click Go
    await IntentionPage.complete(page, testPhrase);

    // Should navigate to google.com
    await expect(page).toHaveURL(/www\.google\.com\/?/);
  });
});
