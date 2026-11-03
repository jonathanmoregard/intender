import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { SettingsPage } from './fixtures/page/settings';
import { IntentionPage } from './fixtures/page/intention';
import {
  launchExtension,
  stopServiceWorker,
  waitForServiceWorkerRunning,
} from './utils/extension';

const phrase = 'I am visiting with a purpose';
const site = 'https://example.com';

async function installSiteFixture(context: BrowserContext) {
  // Exercise real browser navigations and extension listeners without live sites.
  await context.route(`${site}/**`, async route => {
    if (new URL(route.request().url()).pathname === '/redirect') {
      await route.fulfill({
        status: 302,
        headers: { location: `${site}/protected/redirected` },
      });
      return;
    }
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Navigation fixture</title><main>Local fixture</main>',
    });
  });
  const settings = await SettingsPage.openSettingsPage(context);
  await SettingsPage.addIntention(settings, {
    url: 'example.com/protected',
    phrase,
  });
}

async function navigate(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/ERR_ABORTED|interrupted by another navigation/.test(error.message)
    ) {
      throw error;
    }
  }
}

for (const method of ['pushState', 'replaceState'] as const) {
  test(`${method} entering a protected path prompts and can be completed`, async () => {
    const { context } = await launchExtension();
    try {
      await installSiteFixture(context);
      const page = await context.newPage();
      await page.goto(`${site}/outside`);
      await page.evaluate(
        method => history[method]({}, '', '/protected/spa'),
        method
      );
      await expect(page).toHaveURL(IntentionPage.regex);
      expect(new URL(page.url()).searchParams.get('target')).toBe(
        `${site}/protected/spa`
      );
      await IntentionPage.complete(page, phrase);
      await expect(page.locator('main')).toHaveText('Local fixture');
      await page.evaluate(() => history.pushState({}, '', '/outside'));
      await page.evaluate(() => history.pushState({}, '', '/protected/again'));
      await expect(page).toHaveURL(IntentionPage.regex);
    } finally {
      await context.close();
    }
  });
}

test('leaving a scope invalidates allowances even on an immediate revisit', async () => {
  const { context } = await launchExtension();
  try {
    await installSiteFixture(context);
    const page = await context.newPage();
    await navigate(page, `${site}/protected/start`);
    await IntentionPage.complete(page, phrase);
    await page.goto(`${site}/protected/target`);
    await expect(page.locator('main')).toHaveText('Local fixture');
    await page.goto(`${site}/outside`);
    await navigate(page, `${site}/protected/target`);
    await expect(page).toHaveURL(IntentionPage.regex);
  } finally {
    await context.close();
  }
});

test('a server redirect from an unscoped URL into a protected path prompts', async () => {
  const { context } = await launchExtension();
  try {
    await installSiteFixture(context);
    const page = await context.newPage();
    await navigate(page, `${site}/redirect`);
    await expect(page).toHaveURL(IntentionPage.regex);
    expect(new URL(page.url()).searchParams.get('target')).toBe(
      `${site}/protected/redirected`
    );
  } finally {
    await context.close();
  }
});

test('a genuinely restarted worker restores allowed scope and still checks re-entry', async () => {
  const { context } = await launchExtension();
  try {
    await installSiteFixture(context);
    const page = await context.newPage();
    await navigate(page, `${site}/protected/start`);
    await IntentionPage.complete(page, phrase);
    await expect(page.locator('main')).toHaveText('Local fixture');
    // stopServiceWorker only returns once the browser reports termination, so
    // running again after the reload is evidence of a genuine restart.
    await stopServiceWorker(context);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForServiceWorkerRunning(context);
    await expect(page.locator('main')).toHaveText('Local fixture');
    await expect(page).not.toHaveURL(IntentionPage.regex);
    await page.goto(`${site}/outside`);
    await navigate(page, `${site}/protected/start`);
    await expect(page).toHaveURL(IntentionPage.regex);
  } finally {
    await context.close();
  }
});
