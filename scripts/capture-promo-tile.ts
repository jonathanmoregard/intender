/**
 * Generates a 440x280 small promo tile for Chrome Web Store.
 *
 * Usage:
 *   npx tsx scripts/capture-promo-tile.ts
 *
 * Output: store-assets/promo-tile-440x280.png
 */

import { chromium } from 'playwright';
import { mkdir, readFile } from 'fs/promises';
import { resolve, join } from 'path';

const OUTPUT_DIR = resolve(process.cwd(), 'store-assets');

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 440, height: 280 },
  });

  const iconPath = resolve(
    process.cwd(),
    '.output/chrome-mv3/icon/intender-128.png'
  );
  const iconData = await readFile(iconPath);
  const iconBase64 = `data:image/png;base64,${iconData.toString('base64')}`;

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
          background: linear-gradient(135deg, #f5f0e8 0%, #e8dfd0 50%, #d4c9b0 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          position: relative;
        }

        .icon {
          width: 64px;
          height: 64px;
          margin-bottom: 16px;
        }

        .title {
          font-size: 28px;
          font-weight: 700;
          color: #5a4a2a;
          letter-spacing: -0.5px;
          margin-bottom: 8px;
        }

        .tagline {
          font-size: 14px;
          font-weight: 400;
          color: #7a6a4a;
          text-align: center;
          max-width: 340px;
          line-height: 1.4;
        }

        .prompt-preview {
          margin-top: 18px;
          background: rgba(255, 255, 255, 0.9);
          border: 1.5px solid #b0a070;
          border-radius: 8px;
          padding: 8px 20px;
          font-size: 13px;
          color: #5a4a2a;
          font-style: italic;
        }

        .cursor {
          display: inline-block;
          width: 1.5px;
          height: 14px;
          background: #5a4a2a;
          vertical-align: text-bottom;
          margin-left: 1px;
          animation: blink 1s step-end infinite;
        }

        @keyframes blink {
          50% { opacity: 0; }
        }
      </style>
    </head>
    <body>
      <img class="icon" src="${iconBase64}" />
      <div class="title">Intender</div>
      <div class="tagline">Browse with intention</div>
      <div class="prompt-preview">I know why I enter<span class="cursor"></span></div>
    </body>
    </html>
  `,
    { waitUntil: 'networkidle' }
  );

  // Wait for font to load
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: join(OUTPUT_DIR, 'promo-tile-440x280.png'),
    type: 'png',
  });

  console.log('Captured: promo-tile-440x280.png');

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
