/**
 * Captures Chrome Web Store screenshots at 1280x800.
 *
 * Usage:
 *   pnpm build && npx tsx scripts/capture-screenshots.ts
 *
 * Output: store-assets/*.png
 */

import { chromium } from '@playwright/test';
import { mkdtemp, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const VIEWPORT = { width: 1280, height: 800 };
const OUTPUT_DIR = resolve(process.cwd(), 'store-assets');
const EXT_PATH = resolve(process.cwd(), '.output/chrome-mv3');

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const userDataDir = await mkdtemp(join(tmpdir(), 'intender-screenshots-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: VIEWPORT,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--no-default-browser-check',
      '--no-first-run',
      '--disable-popup-blocking',
    ],
  });

  // Wait for service worker to load
  const sw =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker', { timeout: 10000 }));
  const extensionId = new URL(sw.url()).host;

  // --- Seed intentions via storage ---
  await sw.evaluate(async () => {
    const api = (globalThis as any).chrome?.storage;
    await api.sync.set({
      intentions: [
        {
          id: 'demo-1',
          url: 'reddit.com',
          phrase: 'Check the weekly programming thread',
        },
        {
          id: 'demo-2',
          url: 'youtube.com',
          phrase: 'Watch the Rust tutorial part 3',
        },
        {
          id: 'demo-3',
          url: 'twitter.com',
          phrase: 'Reply to the team announcement',
        },
      ],
      fuzzyMatching: true,
      inactivityMode: 'off',
      inactivityTimeoutMs: 1800000,
      showAdvancedSettings: false,
      canCopyIntentionText: false,
      breathAnimationIntensity: 'minimal',
      directToSettings: false,
      debugLogging: false,
    });
  });

  // Small delay for storage to propagate
  await new Promise(r => setTimeout(r, 500));

  // --- Screenshot 1: Intention page ---
  const intentionPage = await context.newPage();
  await intentionPage.setViewportSize(VIEWPORT);

  // Navigate to a URL that triggers the intention page
  try {
    await intentionPage.goto('https://reddit.com', {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
  } catch {
    // Expected: navigation intercepted by extension
  }

  // Wait for intention page to load
  await intentionPage.waitForURL(
    /chrome-extension:\/\/.+\/intention-page\.html/,
    { timeout: 10000 }
  );
  await intentionPage.waitForTimeout(1000); // Let animations settle

  await intentionPage.screenshot({
    path: join(OUTPUT_DIR, '01-intention-page.png'),
    type: 'png',
  });
  console.log('Captured: 01-intention-page.png');

  // --- Screenshot 2: Intention page with partial input ---
  await intentionPage.locator('#phrase').fill('Check the weekly');
  await intentionPage.waitForTimeout(300);

  await intentionPage.screenshot({
    path: join(OUTPUT_DIR, '02-intention-typing.png'),
    type: 'png',
  });
  console.log('Captured: 02-intention-typing.png');
  await intentionPage.close();

  // --- Screenshot 3: Settings page ---
  const settingsPage = await context.newPage();
  await settingsPage.setViewportSize(VIEWPORT);
  await settingsPage.goto(`chrome-extension://${extensionId}/settings.html`);
  await settingsPage.waitForTimeout(1500); // Let React render

  await settingsPage.screenshot({
    path: join(OUTPUT_DIR, '03-settings.png'),
    type: 'png',
  });
  console.log('Captured: 03-settings.png');
  await settingsPage.close();

  // --- Done ---
  await context.close();
  console.log(`\nAll screenshots saved to ${OUTPUT_DIR}/`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
