import { test as base, expect } from '@playwright/test';
import { logSwTestResult } from './utils/extension';

const isThrottled = !!process.env.INTENDER_THROTTLE;

// Extend the base test to add throttling
export const test = base.extend({
  page: async ({ page, context, browserName }, use) => {
    if (isThrottled && browserName === 'chromium') {
      const client = await context.newCDPSession(page);

      // Apply CPU throttling (6x slower)
      await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

      // Apply 3G-like network conditions
      await client.send('Network.enable');
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150, // ms
        downloadThroughput: 75000, // bytes per second (~0.6 Mbit/s)
        uploadThroughput: 35000, // bytes per second
        connectionType: 'cellular3g',
      });

      console.log(
        '🚀 Applied throttling: CPU 6x slower, 3G network conditions'
      );
    }

    await use(page);
  },
});

export { expect };

// Set up SW log basename before each test
base.beforeEach(async ({}, testInfo) => {
  if (process.env.TEST_SW_LOG) {
    const titleSlug = testInfo.titlePath
      .join(' _ ')
      .replace(/[^a-zA-Z0-9-_.\s›:]/g, '_')
      .replace(/[\s:]+/g, ' ')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 100);
    const worker = process.env.TEST_WORKER_INDEX || '0';
    const basename = `${testInfo.project.name}.${titleSlug} - ${testInfo.repeatEachIndex}.w${worker}.log`;
    process.env.INTENDER_SW_LOG_BASENAME = basename;
  }
});

// Append PASS/FAIL/TIMEOUT markers to the SW log file for each test
base.afterEach(async ({}, testInfo) => {
  try {
    const status =
      testInfo.status === 'passed'
        ? 'PASSED'
        : testInfo.status === 'timedOut'
          ? 'TIMED_OUT'
          : testInfo.status === 'skipped'
            ? 'SKIPPED'
            : 'FAILED';

    logSwTestResult(status as 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED', {
      title: testInfo.title,
      repeatEachIndex: testInfo.repeatEachIndex,
      retry: testInfo.retry,
    });
  } catch {}
});
