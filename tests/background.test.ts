import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './helpers/background';

const protectedUrl = 'https://example.com/protected/target';
const outsideUrl = 'https://unrelated.org/';
const intentionPage =
  'chrome-extension://test/intention-page.html?target=example';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function expectPrompt(
  h: Awaited<ReturnType<typeof startBackground>>,
  target = protectedUrl
) {
  expect(h.redirects.length).toBeGreaterThan(0);
  const redirect = new URL(h.redirects.at(-1)!.url);
  expect(redirect.pathname).toBe('/intention-page.html');
  expect(redirect.searchParams.get('target')).toBe(target);
}

describe('navigation lifecycle', () => {
  it('prompts for a top-level protected navigation', async () => {
    const h = await startBackground();
    await h.before(protectedUrl);
    expectPrompt(h);
  });

  it.each([0, 2000, 4000])(
    'a completed allow cannot authorize a later revisit (%i ms)',
    async elapsed => {
      const h = await startBackground({
        url: 'https://example.com/protected/start',
      });
      await h.navigate(protectedUrl);
      expect(h.redirects).toEqual([]);
      await h.navigate(outsideUrl);
      vi.setSystemTime(100000 + elapsed);
      await h.navigate(protectedUrl);
      expectPrompt(h);
    }
  );

  it('a newer navigation supersedes an unfinished allow', async () => {
    const h = await startBackground({
      url: 'https://example.com/protected/start',
    });
    await h.before(protectedUrl);
    await h.navigate(outsideUrl);
    await h.before(protectedUrl);
    expectPrompt(h);
  });

  it('rule edits invalidate an earlier no-match decision', async () => {
    const h = await startBackground();
    await h.navigate('https://new-example.org/path');
    await h.navigate(outsideUrl);
    await h.changeRules([
      { id: 'new-rule', url: 'new-example.org', phrase: 'Reflect' },
    ]);
    await h.before('https://new-example.org/path');
    expectPrompt(h, 'https://new-example.org/path');
  });

  it('rule edits during navigation are enforced at commit', async () => {
    const h = await startBackground();
    await h.before('https://new-example.org/path');
    await h.changeRules([
      { id: 'new-rule', url: 'new-example.org', phrase: 'Reflect' },
    ]);
    await h.commit('https://new-example.org/path');
    expectPrompt(h, 'https://new-example.org/path');
  });

  it('a pre-commit block remains blocked if its target commits', async () => {
    const h = await startBackground();
    await h.before(protectedUrl);
    h.redirects.length = 0;
    await h.commit(protectedUrl);
    expectPrompt(h);
  });

  it('completion is allowed across pre-commit and commit', async () => {
    const h = await startBackground({ url: intentionPage });
    await h.navigate(`${protectedUrl}?intention_completed_53c5890=true`);
    expect(h.redirects).toEqual([]);
  });

  it('a completion token without the intention page does not authorize entry', async () => {
    const h = await startBackground();
    const target = `${protectedUrl}?intention_completed_53c5890=true`;
    await h.navigate(target);
    expectPrompt(h, target);
  });

  it('a redirect to a protected scope is checked against its original source', async () => {
    const h = await startBackground();
    await h.before('https://redirect.example/');
    await h.commit(protectedUrl);
    expectPrompt(h);
  });

  it('a redirect returning to the current scope stays allowed', async () => {
    const h = await startBackground({
      url: 'https://example.com/protected/start',
    });
    await h.before('https://redirect.example/');
    await h.commit(protectedUrl);
    expect(h.redirects).toEqual([]);
  });

  it('a background tab may open the active scope', async () => {
    const h = await startBackground({
      url: 'https://example.com/protected/start',
      extraTabs: [{ id: 2, windowId: 1, active: false, url: 'about:blank' }],
    });
    await h.navigate(protectedUrl, 2);
    expect(h.redirects).toEqual([]);
  });

  it('a background allow remains consistent if that tab is activated before commit', async () => {
    const h = await startBackground({
      url: 'https://example.com/protected/start',
      extraTabs: [{ id: 2, windowId: 1, active: false, url: 'about:blank' }],
    });
    await h.before(protectedUrl, 2);
    await h.browser.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    await h.commit(protectedUrl, 2);
    expect(h.redirects).toEqual([]);
  });
});

describe('same-document navigation', () => {
  it('History API entry to a protected path prompts', async () => {
    const h = await startBackground();
    await h.history(protectedUrl);
    expectPrompt(h);
  });

  it('History API navigation within a scope stays allowed', async () => {
    const h = await startBackground({
      url: 'https://example.com/protected/start',
    });
    await h.history(protectedUrl);
    expect(h.redirects).toEqual([]);
  });

  it('History API departure clears the source scope before reentry', async () => {
    const h = await startBackground({
      url: 'https://example.com/protected/start',
    });
    await h.history('https://example.com/public');
    await h.history(protectedUrl);
    expectPrompt(h);
  });

  it('History API departure removes inactivity eligibility', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    await h.history('https://example.com/public');
    await h.focus(-1);
    vi.setSystemTime(102000);
    await h.focus(1);
    expect(h.redirects).toEqual([]);
  });

  it('subframe history changes do not prompt', async () => {
    const h = await startBackground();
    await h.browser.webNavigation.onHistoryStateUpdated.emit({
      tabId: 1,
      frameId: 2,
      url: protectedUrl,
    });
    expect(h.redirects).toEqual([]);
  });
});

describe('focus transitions', () => {
  it.each(['history', 'fragment', 'document'])(
    '%s updates while Chrome is unfocused do not count as user activity',
    async kind => {
      const h = await startBackground({ url: protectedUrl, mode: 'all' });
      await h.focus(-1);
      vi.setSystemTime(102000);
      const target = `${protectedUrl}?poll=1#section`;
      if (kind === 'history') await h.history(target);
      else if (kind === 'document') await h.navigate(target);
      else {
        h.tabs[0].url = target;
        await h.browser.webNavigation.onReferenceFragmentUpdated.emit({
          tabId: 1,
          frameId: 0,
          url: target,
        });
      }
      await h.focus(1);
      expectPrompt(h, target);
    }
  );

  it('an inactive tab cannot reset its scope while a different site is focused', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [{ id: 2, windowId: 1, active: false, url: outsideUrl }],
    });
    h.tabs[0].active = false;
    h.tabs[1].active = true;
    await h.browser.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    vi.setSystemTime(102000);
    await h.history(protectedUrl);
    h.tabs[0].active = true;
    h.tabs[1].active = false;
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expectPrompt(h);
  });

  it('foreground history navigation refreshes activity', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    vi.setSystemTime(102000);
    await h.history(protectedUrl);
    expect(h.session.lastActiveByScope).toEqual({ 'rule-1': 102000 });
  });

  it.each([true, false])(
    'background audio changes (audible=%s) do not exempt all mode',
    async audible => {
      const h = await startBackground({ url: protectedUrl, mode: 'all' });
      await h.focus(-1);
      vi.setSystemTime(102000);
      h.tabs[0].audible = audible;
      await h.browser.tabs.onUpdated.emit(1, { audible }, h.tabs[0]);
      await h.focus(1);
      expectPrompt(h);
    }
  );

  it('audio exemption mode retains the grace period after background playback ends', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all-except-audio',
    });
    h.tabs[0].audible = true;
    await h.browser.tabs.onUpdated.emit(1, { audible: true }, h.tabs[0]);
    await h.focus(-1);
    vi.setSystemTime(102000);
    h.tabs[0].audible = false;
    await h.browser.tabs.onUpdated.emit(1, { audible: false }, h.tabs[0]);
    await h.focus(1);
    expect(h.redirects).toEqual([]);
  });

  it.each([true, false])(
    'muted background playback (audible=%s) does not refresh inactivity',
    async audible => {
      const h = await startBackground({
        url: protectedUrl,
        mode: 'all-except-audio',
      });
      await h.focus(-1);
      vi.setSystemTime(102000);
      Object.assign(h.tabs[0], { audible, mutedInfo: { muted: true } });
      await h.browser.tabs.onUpdated.emit(1, { audible }, h.tabs[0]);
      await h.focus(1);
      expectPrompt(h);
    }
  );

  it('muting background playback starts the inactivity grace period', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all-except-audio',
    });
    h.tabs[0].audible = true;
    await h.browser.tabs.onUpdated.emit(1, { audible: true }, h.tabs[0]);
    await h.focus(-1);
    vi.setSystemTime(102000);
    Object.assign(h.tabs[0], { audible: true, mutedInfo: { muted: true } });
    await h.browser.tabs.onUpdated.emit(
      1,
      { mutedInfo: { muted: true } },
      h.tabs[0]
    );
    await h.focus(1);
    expect(h.redirects).toEqual([]);
    await h.focus(-1);
    vi.setSystemTime(104000);
    await h.focus(1);
    expectPrompt(h);
  });

  it('a change of mute reason cannot turn muted playback into activity', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all-except-audio',
    });
    Object.assign(h.tabs[0], {
      audible: true,
      mutedInfo: { muted: true, reason: 'user' },
    });
    await h.browser.tabs.onUpdated.emit(
      1,
      { audible: true, mutedInfo: { muted: true, reason: 'user' } },
      h.tabs[0]
    );
    await h.focus(-1);
    vi.setSystemTime(102000);
    const mutedInfo = {
      muted: true,
      reason: 'extension',
      extensionId: 'another-extension',
    };
    h.tabs[0].mutedInfo = mutedInfo;
    await h.browser.tabs.onUpdated.emit(1, { mutedInfo }, h.tabs[0]);
    await h.focus(1);
    expectPrompt(h);
  });

  it('unmuting silent background media does not refresh inactivity', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all-except-audio',
    });
    await h.focus(-1);
    vi.setSystemTime(102000);
    Object.assign(h.tabs[0], { audible: false, mutedInfo: { muted: false } });
    await h.browser.tabs.onUpdated.emit(
      1,
      { mutedInfo: { muted: false } },
      h.tabs[0]
    );
    await h.focus(1);
    expectPrompt(h);
  });

  it.each(['startup', 'created', 'replaced'])(
    'playback discovered through %s retains grace when it stops',
    async lifecycle => {
      const playingTab = {
        id: 2,
        windowId: 1,
        active: false,
        url: protectedUrl,
        audible: true,
      };
      const h = await startBackground({
        url: outsideUrl,
        mode: 'all-except-audio',
        extraTabs: lifecycle === 'created' ? [] : [playingTab],
      });
      if (lifecycle === 'created') {
        h.tabs.push(playingTab);
        await h.browser.tabs.onCreated.emit(playingTab);
      } else if (lifecycle === 'replaced') {
        const replacement = { ...playingTab, id: 3 };
        h.tabs.splice(1, 1, replacement);
        await h.browser.tabs.onReplaced.emit(3, 2);
      }
      vi.setSystemTime(102000);
      const tab = h.tabs[1];
      tab.audible = false;
      await h.browser.tabs.onUpdated.emit(tab.id, { audible: false }, tab);
      h.tabs[0].active = false;
      tab.active = true;
      await h.browser.tabs.onActivated.emit({ tabId: tab.id, windowId: 1 });
      expect(h.redirects).toEqual([]);
    }
  );

  it('return from another application after timeout prompts', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    await h.focus(-1);
    vi.setSystemTime(102000);
    await h.focus(1);
    expectPrompt(h);
  });

  it('time spent using the scope is not counted as time away', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    vi.setSystemTime(200000);
    await h.focus(-1);
    vi.setSystemTime(200500);
    await h.focus(1);
    expect(h.redirects).toEqual([]);
  });

  it('same-scope tab switching stays allowed despite an old activity timestamp', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [
        {
          id: 2,
          windowId: 1,
          active: false,
          url: 'https://example.com/protected/other',
        },
      ],
    });
    vi.setSystemTime(102000);
    await h.browser.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    expect(h.redirects).toEqual([]);
  });

  it('same-scope direct window switching stays allowed', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [
        {
          id: 2,
          windowId: 2,
          active: true,
          url: 'https://example.com/protected/other',
        },
      ],
    });
    vi.setSystemTime(102000);
    await h.focus(2);
    expect(h.redirects).toEqual([]);
  });

  it('transient no-window focus between browser windows does not prompt', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [
        {
          id: 2,
          windowId: 2,
          active: true,
          url: 'https://example.com/protected/other',
        },
      ],
    });
    vi.setSystemTime(102000);
    await h.focus(-1);
    await h.focus(2);
    expect(h.redirects).toEqual([]);
  });
});

describe('lifecycle boundaries', () => {
  it('a tab activation while Chrome is unfocused cannot refresh scope activity', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [{ id: 2, windowId: 1, active: false, url: protectedUrl }],
    });
    await h.focus(-1);
    vi.setSystemTime(102000);
    h.tabs[0].active = false;
    h.tabs[1].active = true;
    await h.browser.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    await h.focus(1);
    expectPrompt(h);
  });

  it('hydration drops a scope mapping when the tab has navigated away', async () => {
    const h = await startBackground({
      url: outsideUrl,
      mode: 'all',
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
      },
    });
    await h.focus(-1);
    vi.setSystemTime(102000);
    await h.focus(1);
    expect(h.redirects).toEqual([]);
  });

  it('hydration preserves a still-open scope and its inactivity timestamp', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
      },
    });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    await h.navigate('https://example.com/protected/next');
    expect(h.redirects).toEqual([]);
  });

  it('a replacement active tab remains the source for a same-scope background tab', async () => {
    const h = await startBackground({
      url: protectedUrl,
      extraTabs: [{ id: 2, windowId: 1, active: false, url: 'about:blank' }],
    });
    h.tabs[0].id = 3;
    await h.browser.tabs.onReplaced.emit(3, 1);
    await h.navigate(protectedUrl, 2);
    expect(h.redirects).toEqual([]);
  });

  it('completion permits a server redirect within the completed scope', async () => {
    const h = await startBackground({ url: intentionPage });
    await h.before(`${protectedUrl}?intention_completed_53c5890=true`);
    await h.commit(protectedUrl);
    expect(h.redirects).toEqual([]);
  });

  it('the intention page alone cannot authorize an unchecked committed target', async () => {
    const h = await startBackground({ url: intentionPage });
    await h.commit(protectedUrl);
    expectPrompt(h);
  });

  it('completion of one scope cannot authorize a server redirect into another scope', async () => {
    const h = await startBackground({ url: intentionPage });
    await h.changeRules([
      ...h.settings.intentions,
      { id: 'other-rule', url: 'other.org', phrase: 'Other intention' },
    ]);
    await h.before(`${protectedUrl}?intention_completed_53c5890=true`);
    await h.commit('https://other.org/');
    expectPrompt(h, 'https://other.org/');
  });
});
