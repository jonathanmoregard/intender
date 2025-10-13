import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SettingsPage } from './fixtures/page/settings';
import { expect, test } from './test-setup';
import { launchExtension } from './utils/extension';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('Import/Export', () => {
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

    // Should handle gracefully without crashing - just check that the page is still responsive
    // The malformed file is actually valid JSON with invalid structure, so import might succeed
    // but we just want to ensure the page doesn't crash
    await expect(settingsPage.locator('body')).toBeVisible();

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
    const urlInputs = SettingsPage.locators.urlInputs(settingsPage);
    const phraseInputs = SettingsPage.locators.phraseInputs(settingsPage);

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
    const exportedSettings = JSON.parse(exportedData);

    // Should be new format with all settings
    expect(exportedSettings).toHaveProperty('intentions');
    expect(exportedSettings.intentions).toHaveLength(3);

    // Extract all IDs and verify they are unique
    const exportedIds = exportedSettings.intentions.map(
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

  test('golden test: import-export-import roundtrip should preserve all settings', async () => {
    const { context } = await launchExtension();
    const settingsPage = await SettingsPage.openSettingsPage(context);
    await settingsPage.waitForLoadState('networkidle');

    // First, import the golden settings file
    await SettingsPage.openMoreOptions(settingsPage);
    await SettingsPage.importFromFile(
      settingsPage,
      join(__dirname, 'fixtures/golden-settings.json')
    );

    // Wait for import to complete
    await settingsPage.waitForTimeout(2000);

    // Export the settings
    const exportedData = await SettingsPage.exportToMemory(settingsPage);
    expect(exportedData).toBeTruthy();

    const exportedSettings = JSON.parse(exportedData!);

    // Load the golden file to compare (excluding version and IDs)
    const fs = await import('fs/promises');
    const goldenFilePath = join(__dirname, 'fixtures/golden-settings.json');
    const goldenFileContent = await fs.readFile(goldenFilePath, 'utf-8');
    const goldenData = JSON.parse(goldenFileContent);

    // Compare all settings except version and intention IDs (which get regenerated)
    const compareSettings = (exported: any, golden: any) => {
      // Normalize both objects by setting version and intention IDs to empty strings
      const normalize = (obj: any) => {
        const normalized = JSON.parse(JSON.stringify(obj)); // Deep clone
        normalized.version = '';
        if (normalized.intentions) {
          normalized.intentions.forEach((intention: any) => {
            intention.id = '';
          });
        }
        return normalized;
      };

      // Use JSON.stringify with sorted keys for consistent comparison
      const stringifySorted = (obj: any) => {
        return JSON.stringify(obj, Object.keys(obj).sort());
      };

      if (
        stringifySorted(normalize(exported)) !==
        stringifySorted(normalize(golden))
      ) {
        throw new Error(
          'Settings mismatch after normalization (version and IDs set to empty strings)'
        );
      }

      // Verify that IDs were actually regenerated (not the same as golden)
      if (exported.intentions && golden.intentions) {
        for (let i = 0; i < exported.intentions.length; i++) {
          if (exported.intentions[i].id === golden.intentions[i].id) {
            throw new Error(
              `Intention ${i} ID should be regenerated but wasn't`
            );
          }
        }
      }
    };

    try {
      compareSettings(exportedSettings, goldenData);
      console.log(
        '✅ Golden test passed: import-export-import roundtrip preserved all settings'
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error('❌ Golden test failed:', errorMessage);
      console.error(
        'If this is due to new settings being added, update the golden file:'
      );
      console.error('1. Run the export manually');
      console.error(
        '2. Update tests-e2e/fixtures/golden-settings.json with the new structure'
      );
      console.error(
        '3. Ensure all new settings are included in the golden file'
      );
      throw error;
    }

    await context.close();
  });
});
