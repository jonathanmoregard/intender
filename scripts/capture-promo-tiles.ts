/**
 * Generates Chrome Web Store promo tiles:
 *   - Small promo tile: 440x280
 *   - Marquee promo tile: 1400x560
 *
 * Usage:
 *   pnpm build && npx tsx scripts/capture-promo-tiles.ts
 *
 * Output: store-assets/promo-tile-440x280.png, store-assets/promo-marquee-1400x560.png
 */

import { chromium } from 'playwright';
import { mkdir, readFile } from 'fs/promises';
import { resolve, join } from 'path';

const OUTPUT_DIR = resolve(process.cwd(), 'store-assets');

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();

  // Load shared assets
  const iconPath = resolve(
    process.cwd(),
    '.output/chrome-mv3/icon/intender-128.png'
  );
  const iconData = await readFile(iconPath);
  const iconBase64 = `data:image/png;base64,${iconData.toString('base64')}`;

  const bgPath = resolve(process.cwd(), 'public/assets/misty-1280.jpg');
  const bgData = await readFile(bgPath);
  const bgBase64 = `data:image/jpeg;base64,${bgData.toString('base64')}`;

  const screenshotPath = resolve(
    process.cwd(),
    'store-assets/01-intention-typing.png'
  );
  const screenshotData = await readFile(screenshotPath);
  const screenshotBase64 = `data:image/png;base64,${screenshotData.toString('base64')}`;

  // --- Small Promo Tile (440x280) ---
  {
    const page = await browser.newPage({
      viewport: { width: 440, height: 280 },
    });

    await page.setContent(
      `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            width: 440px;
            height: 280px;
            font-family: 'Inter', system-ui, sans-serif;
            background-image: url('${bgBase64}');
            background-size: cover;
            background-position: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
          }

          /* Subtle overlay for text contrast */
          body::before {
            content: '';
            position: absolute;
            inset: 0;
            background: rgba(245, 240, 232, 0.45);
            z-index: 1;
          }

          .content {
            position: relative;
            z-index: 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }

          .icon {
            width: 72px;
            height: 72px;
            margin-bottom: 14px;
            filter: drop-shadow(0 2px 8px rgba(0,0,0,0.15));
          }

          .title {
            font-size: 38px;
            font-weight: 700;
            color: #2a1e0a;
            letter-spacing: -0.5px;
            margin-bottom: 10px;
            text-shadow: 0 2px 8px rgba(255,255,255,0.8);
          }

          .tagline {
            font-size: 19px;
            font-weight: 600;
            color: #3a2e14;
            text-align: center;
            letter-spacing: 0.4px;
            text-shadow: 0 2px 6px rgba(255,255,255,0.7);
          }
        </style>
      </head>
      <body>
        <div class="content">
          <img class="icon" src="${iconBase64}" />
          <div class="title">Intender</div>
          <div class="tagline">Browse with intention.</div>
        </div>
      </body>
      </html>
    `,
      { waitUntil: 'networkidle' }
    );

    await page.waitForTimeout(1500);

    await page.screenshot({
      path: join(OUTPUT_DIR, 'promo-tile-440x280.png'),
      type: 'png',
    });
    console.log('Captured: promo-tile-440x280.png');
    await page.close();
  }

  // --- Marquee Promo Tile (1400x560) ---
  {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 560 },
    });

    await page.setContent(
      `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          @import url('https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,400;0,700;1,400&display=swap');

          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            width: 1400px;
            height: 560px;
            font-family: 'Inter', system-ui, sans-serif;
            background-image: url('${bgBase64}');
            background-size: cover;
            background-position: center;
            display: flex;
            align-items: center;
            overflow: hidden;
            position: relative;
          }

          /* Gradient overlay: darker on left for text, clearer on right for screenshot */
          body::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(
              to right,
              rgba(245, 240, 232, 0.82) 0%,
              rgba(245, 240, 232, 0.72) 40%,
              rgba(245, 240, 232, 0.25) 65%,
              rgba(245, 240, 232, 0.08) 100%
            );
            z-index: 1;
          }

          .layout {
            position: relative;
            z-index: 2;
            display: flex;
            align-items: center;
            width: 100%;
            height: 100%;
            padding: 0 80px;
          }

          .left {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding-right: 40px;
          }

          .logo-row {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 28px;
          }

          .logo-icon {
            width: 48px;
            height: 48px;
            filter: drop-shadow(0 2px 6px rgba(0,0,0,0.12));
          }

          .logo-text {
            font-size: 22px;
            font-weight: 600;
            color: #3a2e14;
            letter-spacing: 0.3px;
          }

          .headline {
            font-family: 'Merriweather', Georgia, serif;
            font-size: 48px;
            font-weight: 700;
            color: #2e2410;
            line-height: 1.2;
            margin-bottom: 18px;
            letter-spacing: -0.5px;
          }

          .subheadline {
            font-size: 20px;
            font-weight: 400;
            color: #5a4a2a;
            line-height: 1.5;
            max-width: 440px;
          }

          .right {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .screenshot {
            width: 660px;
            border-radius: 12px;
            box-shadow:
              0 20px 60px rgba(0, 0, 0, 0.2),
              0 8px 24px rgba(0, 0, 0, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.4);
          }
        </style>
      </head>
      <body>
        <div class="layout">
          <div class="left">
            <div class="logo-row">
              <img class="logo-icon" src="${iconBase64}" />
              <span class="logo-text">Intender</span>
            </div>
            <div class="headline">Browse with<br>intention.</div>
            <div class="subheadline">Add a mindful pause to your daily habits.</div>
          </div>
          <div class="right">
            <img class="screenshot" src="${screenshotBase64}" />
          </div>
        </div>
      </body>
      </html>
    `,
      { waitUntil: 'networkidle' }
    );

    await page.waitForTimeout(1500);

    await page.screenshot({
      path: join(OUTPUT_DIR, 'promo-marquee-1400x560.png'),
      type: 'png',
    });
    console.log('Captured: promo-marquee-1400x560.png');
    await page.close();
  }

  await browser.close();
  console.log(`\nAll promo tiles saved to ${OUTPUT_DIR}/`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
