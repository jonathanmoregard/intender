import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { SettingsPage } from './fixtures/page/settings';
import { expect, test } from './test-setup';
import { launchExtension } from './utils/extension';

const __dirname = dirname(fileURLToPath(import.meta.url));
type DelayedImportWindow = Window & { releaseImportWrite?: () => void };

async function importPayload(page: Page, payload: unknown) {
  if (!(await page.getByTestId('more-options-dropdown').isVisible())) {
    await SettingsPage.openMoreOptions(page);
  }
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-settings-btn').click();
  await (
    await chooser
  ).setFiles({
    name: 'settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
}

async function savedSettings(page: Page) {
  return page.evaluate(() => chrome.storage.sync.get());
}

function normalize(settings: any) {
  const { version, ...rest } = settings;
  return {
    ...rest,
    intentions: rest.intentions.map(({ id, ...row }: any) => row),
  };
}

test.describe('Import/Export', () => {
  test('a slow import prevents edits and tab changes until its write finishes', async () => {
    const { context } = await launchExtension();
    try {
      const page = await SettingsPage.openSettingsPage(context);
      await SettingsPage.addIntention(page, {
        url: 'existing.example',
        phrase: 'Previous intention',
      });
      // Delay only the browser storage adapter. The picker, parser, editor,
      // debounce and eventual storage write all remain real.
      await page.evaluate(() => {
        const originalSet = chrome.storage.sync.set.bind(chrome.storage.sync);
        const boundary = window as DelayedImportWindow;
        chrome.storage.sync.set = ((
          items: Record<string, unknown>,
          callback?: () => void
        ) => {
          chrome.storage.sync.set = originalSet;
          return new Promise<void>(resolve => {
            boundary.releaseImportWrite = () => {
              if (callback) {
                originalSet(items, () => {
                  callback();
                  resolve();
                });
              } else {
                resolve(originalSet(items));
              }
            };
          });
        }) as typeof chrome.storage.sync.set;
      });
      await importPayload(page, [
        { url: 'imported.example', phrase: 'Imported intention' },
      ]);
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean((window as DelayedImportWindow).releaseImportWrite)
          )
        )
        .toBe(true);
      await expect(page.locator('.options-container')).toHaveAttribute('inert');
      await expect(page.getByRole('status')).toHaveText('Importing settings…');
      // Attempt real pointer/keyboard input while persistence is in flight.
      const box = await SettingsPage.locators.phraseInputs(page).boundingBox();
      await page.mouse.click(box!.x + 10, box!.y + 10);
      await page.keyboard.type('Must not overwrite import');
      await expect(SettingsPage.locators.phraseInputs(page)).toHaveValue(
        'Previous intention'
      );
      const about = await page
        .locator('.tab-btn')
        .filter({ hasText: 'About' })
        .boundingBox();
      await page.mouse.click(about!.x + 10, about!.y + 10);
      await expect(page.locator('.settings-tab')).toBeVisible();
      await expect(page.locator('.about-tab')).toHaveCount(0);
      await page.evaluate(() =>
        (window as DelayedImportWindow).releaseImportWrite!()
      );
      await expect(page.locator('.toast.success')).toContainText('Imported');
      await expect(page.locator('.options-container')).not.toHaveAttribute(
        'inert'
      );
      await expect(SettingsPage.locators.urlInputs(page)).toHaveValue(
        'imported.example'
      );
      await page.reload();
      await expect(SettingsPage.locators.urlInputs(page)).toHaveValue(
        'imported.example'
      );
    } finally {
      await context.close();
    }
  });

  test('switching to About immediately after an edit preserves the pending draft', async () => {
    const { context } = await launchExtension();
    try {
      const page = await SettingsPage.openSettingsPage(context);
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      // Reload before editing so every application timer uses the installed clock.
      await page.reload();
      await expect(SettingsPage.locators.urlInputs(page)).toHaveCount(1);
      await SettingsPage.addIntention(page, {
        url: 'example.com',
        phrase: 'Old phrase',
      });
      // Freeze the debounce timer: tab switching must save without waiting for it.
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      await SettingsPage.locators.phraseInputs(page).fill('Latest draft');
      await page.getByRole('button', { name: 'About', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'About Intender', exact: true })
      ).toBeVisible();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(SettingsPage.locators.phraseInputs(page)).toHaveValue(
        'Latest draft'
      );
      expect((await savedSettings(page)).intentions).toEqual([
        { id: expect.any(String), url: 'example.com', phrase: 'Latest draft' },
      ]);
    } finally {
      await context.close();
    }
  });

  test('manual timeout entries keep the form and storage within the supported range', async () => {
    const { context } = await launchExtension();
    try {
      const page = await SettingsPage.openSettingsPage(context);
      await importPayload(page, {
        intentions: [],
        inactivityMode: 'all',
        showAdvancedSettings: true,
      });
      const input = page.getByTestId('inactivity-timeout-minutes');
      await expect(input).toBeEnabled();
      await input.fill('-10');
      await expect(input).toHaveValue('1');
      await expect
        .poll(async () => (await savedSettings(page)).inactivityTimeoutMs)
        .toBe(60000);
      await input.fill('900');
      await expect(input).toHaveValue('480');
      await expect
        .poll(async () => (await savedSettings(page)).inactivityTimeoutMs)
        .toBe(28800000);
      await page.reload();
      await expect(page.getByTestId('inactivity-timeout-minutes')).toHaveValue(
        '480'
      );
    } finally {
      await context.close();
    }
  });

  for (const [label, payload] of [
    ['unrecognized object', { invalid: 'json' }],
    ['numeric URL', [{ url: 123, phrase: 'test' }]],
    ['non-string phrase', [{ url: 'example.com', phrase: null }]],
    ['invalid boolean', { intentions: [], fuzzyMatching: 'false' }],
    ['invalid timeout', { intentions: [], inactivityTimeoutMs: -1 }],
  ] as const) {
    test(`rejects ${label} without replacing existing settings`, async () => {
      const { context } = await launchExtension();
      try {
        const page = await SettingsPage.openSettingsPage(context);
        await expect(SettingsPage.locators.urlInputs(page)).toHaveCount(1);
        await SettingsPage.addIntention(page, {
          url: 'existing.example',
          phrase: 'Keep this intention',
        });
        const before = await savedSettings(page);
        await importPayload(page, payload);
        await expect(page.locator('.toast.error')).toBeVisible();
        await expect(SettingsPage.locators.urlInputs(page)).toHaveValue(
          'existing.example'
        );
        await expect(SettingsPage.locators.phraseInputs(page)).toHaveValue(
          'Keep this intention'
        );
        expect(await savedSettings(page)).toEqual(before);
      } finally {
        await context.close();
      }
    });
  }

  test('does not change the form when sync storage rejects an oversized import', async () => {
    const { context } = await launchExtension();
    try {
      const page = await SettingsPage.openSettingsPage(context);
      await expect(SettingsPage.locators.urlInputs(page)).toHaveCount(1);
      await SettingsPage.addIntention(page, {
        url: 'existing.example',
        phrase: 'Keep this intention',
      });
      const before = await savedSettings(page);
      // Chrome sync has an 8192-byte per-item quota: exercise the real failure boundary.
      await importPayload(page, [
        { url: 'oversized.example', phrase: 'x'.repeat(10000) },
      ]);
      await expect(page.locator('.toast.error')).toBeVisible();
      await expect(SettingsPage.locators.urlInputs(page)).toHaveValue(
        'existing.example'
      );
      expect(await savedSettings(page)).toEqual(before);
      await expect(page.locator('.options-container')).not.toHaveAttribute(
        'inert'
      );
      await SettingsPage.locators
        .phraseInputs(page)
        .fill('Editable after failure');
      await expect
        .poll(async () => (await savedSettings(page)).intentions[0].phrase)
        .toBe('Editable after failure');
    } finally {
      await context.close();
    }
  });

  test('import supersedes pending autosave and allows an empty settings list', async () => {
    const { context } = await launchExtension();
    try {
      const page = await SettingsPage.openSettingsPage(context);
      await expect(SettingsPage.locators.urlInputs(page)).toHaveCount(1);
      await SettingsPage.locators.urlInputs(page).fill('stale.example');
      await SettingsPage.locators.phraseInputs(page).fill('Do not restore');
      // Let the URL validation message render first: it appears on blur and
      // moves the action row down, which otherwise swallows the mouse-up of
      // the click that opens the menu. The autosave stays pending either way.
      await SettingsPage.locators.urlInputs(page).blur();
      await expect(page.locator('.url-error')).toBeVisible();
      await importPayload(page, []);
      await expect(page.locator('.toast.success')).toContainText('Imported');
      await expect(SettingsPage.locators.urlInputs(page)).toHaveCount(1);
      await expect(SettingsPage.locators.urlInputs(page)).toHaveValue('');
      // Observe past the one-second autosave deadline to catch a stale write.
      await page.waitForTimeout(1200);
      expect((await savedSettings(page)).intentions).toEqual([]);
      await page.reload();
      await expect(SettingsPage.locators.urlInputs(page)).toHaveValue('');
    } finally {
      await context.close();
    }
  });

  test('regenerates duplicate IDs without losing nested intention data', async () => {
    const { context } = await launchExtension();
    try {
      const page = await SettingsPage.openSettingsPage(context);
      const source = JSON.parse(
        await readFile(
          join(__dirname, 'fixtures/duplicate-guids-intentions.json'),
          'utf8'
        )
      );
      await importPayload(page, source);
      await expect(page.locator('.toast.success')).toContainText('Imported');
      const exported = JSON.parse(await SettingsPage.exportToMemory(page));
      const ids = exported.intentions.map((row: any) => row.id);
      expect(new Set(ids).size).toBe(source.length);
      expect(
        ids.every((id: string) => !source.some((row: any) => row.id === id))
      ).toBe(true);
      expect(normalize(exported).intentions).toEqual(
        source.map(({ id, ...row }: any) => row)
      );
    } finally {
      await context.close();
    }
  });

  test('golden import-export-import roundtrip preserves every setting and nested field', async () => {
    const { context } = await launchExtension();
    try {
      const page = await SettingsPage.openSettingsPage(context);
      const golden = JSON.parse(
        await readFile(join(__dirname, 'fixtures/golden-settings.json'), 'utf8')
      );
      // Exercise non-default values, including fields previously omitted from UI updates.
      const source = {
        ...golden,
        fuzzyMatching: false,
        inactivityMode: 'all',
        inactivityTimeoutMs: 120000,
        showAdvancedSettings: true,
        canCopyIntentionText: true,
        breathAnimationIntensity: 'heavy',
        directToSettings: true,
        debugLogging: !(await savedSettings(page)).debugLogging,
      };
      await importPayload(page, source);
      await expect(page.locator('.toast.success')).toContainText('Imported');
      await expect(page.locator('input[type="range"]')).toHaveValue('3');
      await page.locator('.build-footer').click({ clickCount: 5 });
      await expect(
        page.getByRole('checkbox', { name: /Enable debug logging/ })
      ).toBeChecked({ checked: source.debugLogging });
      const first = JSON.parse(await SettingsPage.exportToMemory(page));
      expect(normalize(first)).toEqual(normalize(source));
      await importPayload(page, []);
      await expect(SettingsPage.locators.urlInputs(page)).toHaveValue('');
      await importPayload(page, first);
      await expect(SettingsPage.locators.urlInputs(page)).toHaveCount(
        source.intentions.length
      );
      const second = JSON.parse(await SettingsPage.exportToMemory(page));
      expect(normalize(second)).toEqual(normalize(source));
      expect(second.intentions.map((row: any) => row.id)).not.toEqual(
        first.intentions.map((row: any) => row.id)
      );
      await page.reload();
      await expect(SettingsPage.locators.urlInputs(page).nth(0)).toHaveValue(
        'example.com'
      );
      expect(normalize(await savedSettings(page))).toEqual(normalize(source));
    } finally {
      await context.close();
    }
  });
});
