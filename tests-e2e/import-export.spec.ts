import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { expect, test } from './test-setup';
import { launchExtension, openSettingsPage } from './utils/extension';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testIntentions = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/test-intentions.json'), 'utf-8')
);

const duplicateGuidIntentions = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/duplicate-guids-intentions.json'),
    'utf-8'
  )
);

test.describe('Import/Export', () => {
  test('should import intentions with backwards compatibility', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await openSettingsPage(context);
    await settingsPage.waitForLoadState('networkidle');

    // Use test data from fixture file
    const testData = testIntentions;

    // Open the more options dropdown
    const moreOptionsButton = settingsPage.getByTestId('more-options-btn');
    await moreOptionsButton.click();

    // Wait for dropdown to appear
    await settingsPage
      .getByTestId('more-options-dropdown')
      .waitFor({ state: 'visible' });

    // Set up file upload handler
    const fileChooserPromise = settingsPage.waitForEvent('filechooser');

    // Click import button to trigger file dialog
    const importButton = settingsPage.getByTestId('import-intentions-btn');
    await importButton.click();

    // Handle file selection
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(
      join(__dirname, 'fixtures/test-intentions.json')
    );

    // Wait for import to complete
    await settingsPage.waitForTimeout(2000);

    // Verify both intentions were imported (backwards compatibility)
    const urlInputs = settingsPage.locator('input.url-input');
    const phraseInputs = settingsPage.locator('textarea.phrase-input');

    // Should have both intentions loaded
    await expect(urlInputs).toHaveCount(2);

    // Check the valid intention (first one)
    const firstUrlInput = urlInputs.first();
    const firstPhraseInput = phraseInputs.first();

    await expect(firstUrlInput).toHaveValue('facebook.com');
    await expect(firstPhraseInput).toHaveValue(
      'I want to use events/chat, and have set a 5 minute timer'
    );

    // Check the invalid intention (second one) - should be loaded but invalid
    const secondUrlInput = urlInputs.nth(1);
    const secondPhraseInput = phraseInputs.nth(1);

    await expect(secondUrlInput).toHaveValue('n');
    await expect(secondPhraseInput).toHaveValue('');

    // This tests backwards compatibility - old data with invalid entries should be loaded
    // but the validation should highlight them as invalid

    await context.close();
  });

  test('should export intentions correctly', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await openSettingsPage(context);
    await settingsPage.waitForLoadState('networkidle');

    // Add a test intention
    const urlInput = settingsPage.locator('input.url-input').first();
    const phraseInput = settingsPage.locator('textarea.phrase-input').first();

    await urlInput.fill('example.com');
    await phraseInput.fill('Test export functionality');
    await settingsPage.getByRole('button', { name: 'Save changes' }).click();
    await settingsPage.waitForTimeout(1000);

    // Mock the download functionality
    let downloadedData: string | null = null;
    await settingsPage.exposeFunction('mockDownload', (data: string) => {
      downloadedData = data;
    });

    // Override the download behavior
    await settingsPage.evaluate(() => {
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

    // Open the more options dropdown
    const moreOptionsButton = settingsPage.getByTestId('more-options-btn');
    await moreOptionsButton.click();

    // Wait for dropdown to appear
    await settingsPage
      .getByTestId('more-options-dropdown')
      .waitFor({ state: 'visible' });

    // Click export button
    const exportButton = settingsPage.getByTestId('export-intentions-btn');
    await exportButton.click();
    await settingsPage.waitForTimeout(1000);

    // Verify export data
    expect(downloadedData).toBeTruthy();
    const exportedData = JSON.parse(downloadedData!);

    expect(exportedData).toHaveLength(1);
    expect(exportedData[0]).toMatchObject({
      url: 'example.com',
      phrase: 'Test export functionality',
    });
    expect(exportedData[0]).toHaveProperty('id');
    expect(typeof exportedData[0].id).toBe('string');

    await context.close();
  });

  test('should handle malformed import data gracefully', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await openSettingsPage(context);
    await settingsPage.waitForLoadState('networkidle');

    // Open the more options dropdown
    const moreOptionsButton = settingsPage.locator('.more-options-btn');
    await moreOptionsButton.click();

    // Wait for dropdown to appear
    await settingsPage.waitForSelector('.more-options-dropdown.show');

    // Set up file upload handler
    const fileChooserPromise = settingsPage.waitForEvent('filechooser');

    // Click import button to trigger file dialog
    const importButton = settingsPage.getByTestId('import-intentions-btn');
    await importButton.click();

    // Handle file selection with malformed JSON
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(
      join(__dirname, 'fixtures/malformed-intentions.json')
    );

    // Wait for import attempt
    await settingsPage.waitForTimeout(2000);

    // Should show error toast or handle gracefully without crashing
    // The page should still be functional
    await expect(settingsPage.locator('input.url-input').first()).toBeVisible();

    await context.close();
  });

  test('should regenerate GUIDs for duplicate IDs on import', async () => {
    const { context } = await launchExtension();
    const { settingsPage } = await openSettingsPage(context);
    await settingsPage.waitForLoadState('networkidle');

    // Open the more options dropdown
    const moreOptionsButton = settingsPage.getByTestId('more-options-btn');
    await moreOptionsButton.click();

    // Wait for dropdown to appear
    await settingsPage
      .getByTestId('more-options-dropdown')
      .waitFor({ state: 'visible' });

    // Set up file upload handler
    const fileChooserPromise = settingsPage.waitForEvent('filechooser');

    // Click import button to trigger file dialog
    const importButton = settingsPage.getByTestId('import-intentions-btn');
    await importButton.click();

    // Handle file selection with duplicate GUIDs
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(
      join(__dirname, 'fixtures/duplicate-guids-intentions.json')
    );

    // Wait for import to complete
    await settingsPage.waitForTimeout(2000);

    // Verify all three intentions were imported
    const urlInputs = settingsPage.locator('input.url-input');
    const phraseInputs = settingsPage.locator('textarea.phrase-input');

    await expect(urlInputs).toHaveCount(3);

    // Check that all intentions have the expected content
    await expect(urlInputs.nth(0)).toHaveValue('example1.com');
    await expect(phraseInputs.nth(0)).toHaveValue(
      'First intention with duplicate ID'
    );

    await expect(urlInputs.nth(1)).toHaveValue('example2.com');
    await expect(phraseInputs.nth(1)).toHaveValue(
      'Second intention with same duplicate ID'
    );

    await expect(urlInputs.nth(2)).toHaveValue('example3.com');
    await expect(phraseInputs.nth(2)).toHaveValue(
      'Third intention with same duplicate ID'
    );

    // Now export to verify GUIDs were regenerated
    let exportedData: string | null = null;
    await settingsPage.exposeFunction('mockDownload', (data: string) => {
      exportedData = data;
    });

    // Override the download behavior
    await settingsPage.evaluate(() => {
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

    // Open dropdown again for export
    await settingsPage.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight)
    );
    await settingsPage.waitForTimeout(500);

    const dropdown = settingsPage.getByTestId('more-options-dropdown');
    const openBtn = settingsPage.getByTestId('more-options-btn');

    await openBtn.scrollIntoViewIfNeeded();
    await openBtn.click();

    // Retry once if not visible yet (React re-render or layout shift)
    try {
      await dropdown.waitFor({ state: 'visible', timeout: 1000 });
    } catch {
      await openBtn.click();
      await dropdown.waitFor({ state: 'visible', timeout: 4000 });
    }

    // Click export button
    const exportButton = settingsPage.getByTestId('export-intentions-btn');
    await exportButton.waitFor({ state: 'visible', timeout: 5000 });
    await exportButton.scrollIntoViewIfNeeded();
    await exportButton.click();
    await settingsPage.waitForTimeout(2000);

    // Verify export data has unique GUIDs
    expect(exportedData).toBeTruthy();
    const exportedIntentions = JSON.parse(exportedData!);

    expect(exportedIntentions).toHaveLength(3);

    // Extract all IDs and verify they are unique
    const exportedIds = exportedIntentions.map(
      (intention: any) => intention.id
    );
    const uniqueIds = new Set(exportedIds);

    expect(uniqueIds.size).toBe(3); // All IDs should be unique
    expect(exportedIds).not.toContain('9fd9cc7d-2af2-4162-8a0e-c8bbf47b728d'); // Original duplicate ID should not exist

    // Verify all IDs are valid UUIDs
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    exportedIds.forEach((id: string) => {
      expect(id).toMatch(uuidRegex);
    });

    await context.close();
  });
});
