import {
  BrowserContext,
  expect,
  Page,
  type FileChooser,
} from '@playwright/test';
import { getExtensionId } from '../../utils/extension';

export const SettingsPage = {
  domain: 'chrome-extension',
  regex: /settings\.html$/,

  async openSettingsPage(
    context: BrowserContext,
    params?: { e2eInactivityTimeoutMs?: number }
  ): Promise<Page> {
    const extensionId = await getExtensionId(context);
    const url = new URL(`chrome-extension://${extensionId}/settings.html`);
    if (params?.e2eInactivityTimeoutMs) {
      url.searchParams.set(
        'e2eInactivityTimeoutMs',
        String(params.e2eInactivityTimeoutMs)
      );
    }
    const settingsPage = await context.newPage();
    await settingsPage.goto(url.toString());
    await this.settleAutoFocus(settingsPage);
    return settingsPage;
  },

  /**
   * Wait out the page's own focus timers before touching a field.
   *
   * Settings focuses the first empty website field 100ms after the initial
   * load, and a newly added row's field 50ms after the click. Playwright's
   * fill() inserts into whatever is focused at insertion time, so a timer
   * landing mid-helper drops the text into the previous field and resets the
   * blur-driven validation state. Both reproduce only when the machine is
   * loaded enough for the timer to outlast the next helper call.
   */
  async settleAutoFocus(page: Page, index?: number): Promise<void> {
    const urlInputs = this.locators.urlInputs(page);
    await expect(urlInputs.first()).toBeAttached();
    const target = index ?? (await this.firstEmptyRowIndex(page));
    if (target === -1) return;
    await expect(urlInputs.nth(target)).toBeFocused();
  },

  async firstEmptyRowIndex(page: Page): Promise<number> {
    return page.evaluate(() => {
      const value = (input: HTMLInputElement | undefined) =>
        (input?.value ?? '').trim();
      const urls = Array.from(
        document.querySelectorAll<HTMLInputElement>('input.url-input')
      );
      const phrases = Array.from(
        document.querySelectorAll<HTMLInputElement>('input.phrase-input')
      );
      return urls.findIndex(
        (url, index) => value(url) === '' && value(phrases[index]) === ''
      );
    });
  },

  /** Add an empty intention row and wait for its website field to be focused. */
  async addIntentionRow(page: Page): Promise<void> {
    const urlInputs = this.locators.urlInputs(page);
    const before = await urlInputs.count();
    await page.getByRole('button', { name: 'Add Intention' }).click();
    await expect(urlInputs).toHaveCount(before + 1);
    await this.settleAutoFocus(page, before);
  },

  async openMoreOptions(page: Page): Promise<void> {
    const moreOptionsButton = page.getByTestId('more-options-btn');
    if (!(await page.getByTestId('more-options-dropdown').isVisible())) {
      await moreOptionsButton.click();
    }
    await page
      .getByTestId('more-options-dropdown')
      .waitFor({ state: 'visible' });
  },

  async importFromFile(
    page: Page,
    files: Parameters<FileChooser['setFiles']>[0]
  ): Promise<void> {
    const fileChooserPromise = page.waitForEvent('filechooser');
    const importButton = page.getByTestId('import-settings-btn');
    await importButton.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(files);
    await expect(page.locator('.toast')).toBeVisible();
  },

  async exportToMemory(page: Page): Promise<string> {
    await this.openMoreOptions(page);
    const pendingDownload = page.waitForEvent('download');
    await page.getByTestId('export-settings-btn').click();
    const download = await pendingDownload;
    expect(await download.failure()).toBeNull();
    const stream = await download.createReadStream();
    let data = '';
    for await (const chunk of stream) data += chunk.toString();
    expect(data).not.toBe('');
    return data;
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

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect
      .poll(() =>
        page.evaluate(async i => {
          const { intentions } = await chrome.storage.sync.get('intentions');
          const row = intentions?.[i];
          return row ? { url: row.url, phrase: row.phrase } : null;
        }, index)
      )
      .toEqual(params);
  },

  locators: {
    urlInputs: (page: Page) => page.locator('input.url-input'),
    phraseInputs: (page: Page) => page.locator('input.phrase-input'),
    saveButton: (page: Page) =>
      page.getByRole('button', { name: 'Save changes' }),
  },
};
