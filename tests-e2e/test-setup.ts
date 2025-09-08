import { test as base, expect } from '@playwright/test';

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
