import { Page, expect } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const AudioTestPage = {
  url: 'https://jonathanmoregard.github.io/intender/test/assets/',
  domain: 'jonathanmoregard.github.io',
  regex: /https:\/\/jonathanmoregard\.github\.io\/intender\/test\/assets\//,

  fixtures: {
    asset: (file: string): string =>
      join(__dirname, '..', '..', 'assets', file),
  },

  async open(page: Page): Promise<void> {
    await page.goto(this.url);
    await expect(page.locator('#player')).toBeVisible();
  },

  async play(page: Page): Promise<void> {
    // Ensure we're on the target page (should already be there from openAndCompleteIntention)
    const currentUrl = page.url();
    if (!currentUrl.includes(this.url)) {
      throw new Error(
        'startAudioPlayback expects to be called on a page already at the target URL'
      );
    }

    // Click the play button
    const playButton = page.getByTestId('fixture-play');
    await playButton.waitFor({ state: 'visible' });
    await playButton.click();

    // Wait for audio to actually start playing
    await page.waitForFunction(
      () => {
        // @ts-ignore
        const audio = document.querySelector('audio');
        return !!audio && !audio.paused && audio.currentTime > 0;
      },
      { timeout: 5000 }
    );
  },

  async isPlaying(page: Page): Promise<boolean> {
    return await page.evaluate(() => {
      const audio = document.getElementById(
        'player'
      ) as HTMLAudioElement | null;
      return !!audio && !audio.paused;
    });
  },
};
