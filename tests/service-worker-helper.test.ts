import { EventEmitter } from 'node:events';
import type { BrowserContext } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  stopServiceWorker,
  waitForServiceWorkerRunning,
} from '../tests-e2e/utils/extension';

function browserFixture(outcome: 'stop' | 'error' | 'no-stop') {
  let running = true;
  let detached = false;
  const worker = Object.assign(new EventEmitter(), {
    url: () => 'chrome-extension://review/background.js',
    evaluate: async () => undefined,
  });
  const report = (runningStatus: string) =>
    client.emit('ServiceWorker.workerVersionUpdated', {
      versions: [
        {
          versionId: 'unrelated',
          scriptURL: 'https://example.com/sw.js',
          runningStatus: 'running',
        },
        {
          versionId: 'extension',
          scriptURL: worker.url(),
          runningStatus,
        },
      ],
    });
  const client = Object.assign(new EventEmitter(), {
    send: async (method: string, params?: { versionId: string }) => {
      if (method === 'ServiceWorker.enable') {
        report('running');
      }
      if (method === 'ServiceWorker.stopWorker') {
        if (outcome === 'error') throw new Error('CDP stop failed');
        if (params?.versionId === 'extension' && outcome === 'stop') {
          running = false;
          // Chrome reports the transition; Playwright's Worker stays open.
          report('stopped');
        }
      }
    },
    detach: async () => {
      detached = true;
    },
  });
  const context = {
    // Playwright keeps the Worker object across a stop, so the helper has to
    // read the running state from Chrome's reports rather than from this list.
    serviceWorkers: () => [worker],
    pages: () => [{}],
    newCDPSession: async () => client,
  } as unknown as BrowserContext;
  return {
    context,
    worker,
    client,
    isRunning: () => running,
    isDetached: () => detached,
  };
}

afterEach(() => vi.useRealTimers());

describe('service worker shutdown verification', () => {
  it('terminates the extension worker and cleans up its CDP connection', async () => {
    const f = browserFixture('stop');
    await stopServiceWorker(f.context);
    expect(f.isRunning()).toBe(false);
    expect(f.isDetached()).toBe(true);
    expect(f.client.listenerCount('ServiceWorker.workerVersionUpdated')).toBe(
      0
    );
  });

  it('confirms the worker is reported running again after a restart', async () => {
    const f = browserFixture('stop');
    await stopServiceWorker(f.context);
    expect(f.isRunning()).toBe(false);
    await waitForServiceWorkerRunning(f.context);
    expect(f.isDetached()).toBe(true);
    expect(f.client.listenerCount('ServiceWorker.workerVersionUpdated')).toBe(
      0
    );
  });

  it('fails the test when Chrome refuses to stop the worker', async () => {
    const f = browserFixture('error');
    await expect(stopServiceWorker(f.context)).rejects.toThrow(
      'CDP stop failed'
    );
    expect(f.isDetached()).toBe(true);
  });

  it('requires observed termination, not just an acknowledged stop request', async () => {
    vi.useFakeTimers();
    const f = browserFixture('no-stop');
    const assertion = expect(stopServiceWorker(f.context)).rejects.toThrow(
      /terminat/i
    );
    await Promise.all([assertion, vi.advanceTimersByTimeAsync(10000)]);
    expect(f.isRunning()).toBe(true);
    expect(f.isDetached()).toBe(true);
    expect(f.client.listenerCount('ServiceWorker.workerVersionUpdated')).toBe(
      0
    );
  });
});
