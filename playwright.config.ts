import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  timeout: 60000, // 1 minute timeout
  projects: [
    {
      name: 'e2e-parallel',
      grepInvert: /@serial/,
      fullyParallel: true,
      workers: process.env.CI ? 2 : 4,
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
