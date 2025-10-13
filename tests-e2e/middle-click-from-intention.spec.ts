import type { Page } from '@playwright/test';
import { AudioTestPage } from './fixtures/page/audio-test';
import { IntentionPage } from './fixtures/page/intention';
import { SettingsPage } from './fixtures/page/settings';
import { expect, test } from './test-setup';
import { launchExtension } from './utils/extension';

test.describe('Middle-click from intention page to same scope', () => {
  test('new tab should open directly to target within same scope (not intention page)', async () => {
    const testPhrase = 'I intend to test intentionally';
    const { context } = await launchExtension();

    // Configure intention for audio test page
    const settings = await SettingsPage.openSettingsPage(context);
    await SettingsPage.addIntention(settings, {
      url: AudioTestPage.domain,
      phrase: testPhrase,
    });

    // Navigate to a scoped site → should go to intention page first
    const page: Page = await context.newPage();
    try {
      await page.goto(AudioTestPage.url, { waitUntil: 'domcontentloaded' });
    } catch {
      // Navigation aborted due to redirect is expected
    }

    // Complete the intention
    await expect(page).toHaveURL(IntentionPage.regex);
    await IntentionPage.complete(page, testPhrase);
    await expect(page).toHaveURL(AudioTestPage.regex);

    // Inject a same-scope link and middle-click it to open in a new tab
    const targetUrl = AudioTestPage.url + '?test=middle-click';
    await page.evaluate((href: string) => {
      const a = document.createElement('a');
      a.id = 'same-scope-link';
      a.href = href;
      a.target = '_blank';
      a.textContent = 'open same scope';
      document.body.appendChild(a);
    }, targetUrl);

    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.click('#same-scope-link', { button: 'middle' }),
    ]);

    // New tab should open directly to the same-scope target without requiring intention again
    await expect(newPage).toHaveURL(AudioTestPage.regex);
  });
});
