import { defineConfig, devices } from '@playwright/test';

const isThrottled = !!process.env.INTENDER_THROTTLE;

export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: !isThrottled, // Disable parallel when throttled
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: isThrottled ? 1 : process.env.CI ? 2 : undefined, // Single worker when throttled
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
    // Add throttling launch options
    launchOptions: isThrottled
      ? {
          args: [
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-ipc-flooding-protection',
            '--disable-automatic-tab-discarding',
            '--force-device-scale-factor=0.5',
          ],
        }
      : undefined,
  },
  timeout: 120000, // 2 minutes standard
  projects: [
    {
      name: 'e2e-parallel',
      grepInvert: /@serial/,
      fullyParallel: !isThrottled,
      workers: isThrottled ? 1 : process.env.CI ? 2 : 4,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-serial',
      grep: /@serial/,
      workers: 1,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: '.test-results',
});
