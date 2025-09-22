import { waitForSyncStorageChange } from '@/tests-e2e/utils/extension';
import { BrowserContext, expect, Page } from '@playwright/test';

export const SettingsPage = {
  url: 'chrome-extension://__EXTENSION_ID__/settings.html',
  domain: 'chrome-extension',
  regex: /settings\.html$/,

  async openSettingsPage(
    context: BrowserContext
  ): Promise<{ settingsPage: Page }> {
    const pages = context.pages();
    const extensionPage = pages.find(p => p.url().includes('settings.html'));
    if (extensionPage) {
      return { settingsPage: extensionPage };
    }
    const page = await context.newPage();
    await page.goto(this.url);
    return { settingsPage: page };
  },

  async openMoreOptions(page: Page): Promise<void> {
    const moreOptionsButton = page.getByTestId('more-options-btn');
    await moreOptionsButton.click();
    await page
      .getByTestId('more-options-dropdown')
      .waitFor({ state: 'visible' });
  },

  async importFromFile(page: Page, absolutePath: string): Promise<void> {
    const fileChooserPromise = page.waitForEvent('filechooser');
    const importButton = page.getByTestId('import-intentions-btn');
    await importButton.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(absolutePath);
    await page.waitForTimeout(1000);
  },

  async exportToMemory(page: Page): Promise<string> {
    // Scroll to bottom and open dropdown with retry logic
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    const dropdown = page.getByTestId('more-options-dropdown');
    const openBtn = page.getByTestId('more-options-btn');

    await openBtn.scrollIntoViewIfNeeded();
    await openBtn.click();

    // Retry once if not visible yet (React re-render or layout shift)
    try {
      await dropdown.waitFor({ state: 'visible', timeout: 1000 });
    } catch {
      await openBtn.click();
      await dropdown.waitFor({ state: 'visible', timeout: 4000 });
    }

    // Set up download mocking
    let downloadedData: string | null = null;
    await page.exposeFunction('mockDownload', (data: string) => {
      downloadedData = data;
    });
    await page.evaluate(() => {
      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = function (blob: Blob) {
        const reader = new FileReader();
        reader.onload = function () {
          (window as any).mockDownload(reader.result as string);
        };
        reader.readAsText(blob);
        return 'mock-url';
      };
    });

    // Click export button with robust waiting
    const exportButton = page.getByTestId('export-intentions-btn');
    await exportButton.waitFor({ state: 'visible', timeout: 5000 });
    await exportButton.scrollIntoViewIfNeeded();
    await exportButton.click();
    await page.waitForTimeout(2000);

    expect(downloadedData).toBeTruthy();
    return downloadedData!;
  },

  async addIntention(
    page: Page,
    params: { url: string; phrase: string }
  ): Promise<void> {
    await this.addIntentionAt(page, 0, params);
  },

  async addIntentionAt(
    page: Page,
    index: number,
    params: { url: string; phrase: string }
  ): Promise<void> {
    const urlInput = this.locators.urlInputs(page).nth(index);
    const phraseInput = this.locators.phraseInputs(page).nth(index);
    await urlInput.fill(params.url);
    await phraseInput.fill(params.phrase);

    await waitForSyncStorageChange(page, ['intentions']);

    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForTimeout(300);
  },

  locators: {
    urlInputs: (page: Page) => page.locator('input.url-input'),
    phraseInputs: (page: Page) => page.locator('textarea.phrase-input'),
    saveButton: (page: Page) =>
      page.getByRole('button', { name: 'Save changes' }),
  },
};
