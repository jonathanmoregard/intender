import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SettingsPage } from './fixtures/page/settings';
import { expect, test } from './test-setup';
import { launchExtension } from './utils/extension';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('Import/Export', () => {
  test('should import intentions with backwards compatibility', async () => {
    const { context } = await launchExtension();
    const settingsPage = await SettingsPage.openSettingsPage(context);
    await settingsPage.waitForLoadState('networkidle');

    // Open the more options dropdown
    await SettingsPage.openMoreOptions(settingsPage);
    await SettingsPage.importFromFile(
      settingsPage,
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
    const settingsPage = await SettingsPage.openSettingsPage(context);
    await settingsPage.waitForLoadState('networkidle');

    // Add a test intention
    await SettingsPage.addIntention(settingsPage, {
      url: 'example.com',
      phrase: 'Test export functionality',
    });

    // Open the more options dropdown
    await SettingsPage.openMoreOptions(settingsPage);

    // Export to memory using page model helper
    const downloadedData = await SettingsPage.exportToMemory(settingsPage);

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
    const settingsPage = await SettingsPage.openSettingsPage(context);
    await settingsPage.waitForLoadState('networkidle');

    // Open the more options dropdown
    await SettingsPage.openMoreOptions(settingsPage);

    // Import malformed JSON via page model
    await SettingsPage.importFromFile(
      settingsPage,
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
    const settingsPage = await SettingsPage.openSettingsPage(context);
    await settingsPage.waitForLoadState('networkidle');

    // Open the more options dropdown
    await SettingsPage.openMoreOptions(settingsPage);

    // Import duplicate GUIDs via page model
    await SettingsPage.importFromFile(
      settingsPage,
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

    const exportedData = await SettingsPage.exportToMemory(settingsPage);

    // Verify export data has unique GUIDs
    expect(exportedData).toBeTruthy();
    const exportedIntentions = JSON.parse(exportedData);

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
