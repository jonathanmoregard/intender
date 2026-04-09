/**
 * Captures Chrome Web Store screenshots at 1280x800 using "Header Frame" layout:
 * - Top 20%: bold text on cream background
 * - Bottom 80%: screenshot scaled to ~85% with drop shadow
 *
 * Usage:
 *   pnpm wxt build --mode development && npx tsx scripts/capture-screenshots.ts
 *
 * Output: store-assets/*.png
 */

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const VIEWPORT = { width: 1280, height: 800 };
const OUTPUT_DIR = resolve(process.cwd(), 'store-assets');
const EXT_PATH = resolve(process.cwd(), '.output/chrome-mv3-dev');

/** Capture a raw screenshot as a base64 PNG data URL */
async function captureRaw(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: 'png' });
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/** Create a "Header Frame" screenshot: text on top, screenshot card below */
async function createFramedScreenshot(
  context: BrowserContext,
  screenshotBase64: string,
  headline: string,
  outputPath: string
) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  await page.setContent(
    `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
          width: 1280px;
          height: 800px;
          background: #fbf8f1;
          display: flex;
          flex-direction: column;
          align-items: center;
          overflow: hidden;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .header {
          height: 160px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .headline {
          font-size: 30px;
          font-weight: 700;
          color: #2a1e0a;
          letter-spacing: -0.3px;
          text-align: center;
        }

        .screenshot-area {
          flex: 1;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 0 40px 40px;
        }

        .screenshot {
          width: 1088px;
          height: auto;
          border-radius: 10px;
          box-shadow:
            0 12px 40px rgba(0, 0, 0, 0.12),
            0 4px 16px rgba(0, 0, 0, 0.06);
          border: 1px solid rgba(200, 190, 170, 0.3);
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="headline">${headline}</div>
      </div>
      <div class="screenshot-area">
        <img class="screenshot" src="${screenshotBase64}" />
      </div>
    </body>
    </html>
  `,
    { waitUntil: 'networkidle' }
  );

  await page.waitForTimeout(500);

  await page.screenshot({
    path: outputPath,
    type: 'png',
  });

  await page.close();
}

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
    await api.local.set({
      intentions: [
        {
          id: 'demo-1',
          url: 'reddit.com',
          phrase: "I'm only going to read programming subreddits",
        },
        {
          id: 'demo-2',
          url: 'imgur.com',
          phrase: "I'm only going to look at beautiful landscape pictures",
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

  await new Promise(r => setTimeout(r, 500));

  // --- Raw 1: Intention page with partial input ---
  const intentionPage = await context.newPage();
  await intentionPage.setViewportSize(VIEWPORT);

  const intentionUrl =
    `chrome-extension://${extensionId}/intention-page.html` +
    `?target=${encodeURIComponent('https://reddit.com')}` +
    `&intentionScopeId=demo-1`;
  await intentionPage.goto(intentionUrl, { waitUntil: 'domcontentloaded' });
  await intentionPage.waitForTimeout(1000);

  await intentionPage.locator('#phrase').fill("I'm only going to read prog");
  await intentionPage.waitForTimeout(300);

  const raw01 = await captureRaw(intentionPage);
  await intentionPage.close();

  await createFramedScreenshot(
    context,
    raw01,
    'Pause before you scroll.',
    join(OUTPUT_DIR, '01-intention-typing.png')
  );
  console.log('Captured: 01-intention-typing.png');

  // --- Raw 2: Popup quick-add (imgur) ---
  const popupPage = await context.newPage();
  await popupPage.setViewportSize(VIEWPORT);

  await popupPage.addInitScript(() => {
    window.close = () => {};
    Object.defineProperty(window, '__intenderBlockRedirect', { value: true });
  });

  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded',
  });
  await popupPage.waitForTimeout(1500);

  await popupPage.evaluate(() => {
    const optionsCard = document.getElementById('options-card');
    const overlay = document.getElementById('quick-add-overlay');
    if (optionsCard) optionsCard.classList.add('hidden');
    if (overlay) overlay.classList.add('visible');

    const urlInput = document.getElementById(
      'quick-add-url'
    ) as HTMLInputElement;
    const phraseInput = document.getElementById(
      'quick-add-phrase'
    ) as HTMLTextAreaElement;
    if (urlInput) urlInput.value = 'imgur.com';
    if (phraseInput)
      phraseInput.value =
        "I'm only going to look at beautiful landscape pictures";

    document.body.style.display = 'flex';
    document.body.style.alignItems = 'center';
    document.body.style.justifyContent = 'center';
    document.body.style.width = '1280px';
    document.body.style.height = '800px';
    document.body.style.overflow = 'hidden';

    const container = document.querySelector('.popup-container') as HTMLElement;
    if (container) {
      container.style.transform = 'scale(2)';
      container.style.transformOrigin = 'center center';
    }

    overlay!.style.position = 'relative';
    overlay!.style.display = 'flex';
  });
  await popupPage.waitForTimeout(300);

  const raw02 = await captureRaw(popupPage);
  await popupPage.close();

  await createFramedScreenshot(
    context,
    raw02,
    'Quickly add sites on the go.',
    join(OUTPUT_DIR, '02-quick-add.png')
  );
  console.log('Captured: 02-quick-add.png');

  // --- Raw 3: Settings page ---
  const settingsPage = await context.newPage();
  await settingsPage.setViewportSize(VIEWPORT);
  await settingsPage.goto(`chrome-extension://${extensionId}/settings.html`);
  await settingsPage.waitForTimeout(1500);

  const raw03 = await captureRaw(settingsPage);
  await settingsPage.close();

  await createFramedScreenshot(
    context,
    raw03,
    'Easily manage your digital habits.',
    join(OUTPUT_DIR, '03-settings.png')
  );
  console.log('Captured: 03-settings.png');

  // --- Screenshot 4: Privacy graphic (standalone, no frame needed) ---
  {
    const privacyPage = await context.newPage();
    await privacyPage.setViewportSize(VIEWPORT);
    await privacyPage.setContent(
      `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            width: 1280px;
            height: 800px;
            font-family: 'Inter', system-ui, sans-serif;
            background: #fbf8f1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }

          .shield {
            width: 100px;
            height: 100px;
            margin-bottom: 36px;
          }

          .headline {
            font-size: 42px;
            font-weight: 700;
            color: #2a1e0a;
            letter-spacing: -0.5px;
            margin-bottom: 16px;
            text-align: center;
          }

          .subtext {
            font-size: 20px;
            font-weight: 400;
            color: #5a4a2a;
            text-align: center;
            line-height: 1.6;
            max-width: 600px;
          }

          .badges {
            display: flex;
            gap: 32px;
            margin-top: 40px;
          }

          .badge {
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(255, 255, 255, 0.6);
            border: 1px solid rgba(180, 170, 140, 0.4);
            border-radius: 12px;
            padding: 14px 24px;
            font-size: 16px;
            font-weight: 600;
            color: #3a2e14;
          }

          .badge-icon {
            font-size: 22px;
            line-height: 1;
          }
        </style>
      </head>
      <body>
        <div class="shield">
          <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M50 5 L90 25 L90 55 Q90 80 50 95 Q10 80 10 55 L10 25 Z"
                  fill="none" stroke="#5a4a2a" stroke-width="3" opacity="0.8"/>
            <path d="M38 52 L46 60 L64 42" fill="none" stroke="#6b8a3e" stroke-width="5"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="headline">100% Private. Offline. Open Source.</div>
        <div class="subtext">Your data never leaves your device.<br>No accounts. No analytics. No servers.</div>
        <div class="badges">
          <div class="badge"><span class="badge-icon">&#x1f512;</span> Local storage only</div>
          <div class="badge"><span class="badge-icon">&#x1f310;</span> Works offline</div>
          <div class="badge"><span class="badge-icon">&#x1f4dc;</span> AGPL-3.0 licensed</div>
        </div>
      </body>
      </html>
    `,
      { waitUntil: 'networkidle' }
    );

    await privacyPage.waitForTimeout(1500);

    await privacyPage.screenshot({
      path: join(OUTPUT_DIR, '04-privacy.png'),
      type: 'png',
    });
    console.log('Captured: 04-privacy.png');
    await privacyPage.close();
  }

  // --- Done ---
  await context.close();
  console.log(`\nAll screenshots saved to ${OUTPUT_DIR}/`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
