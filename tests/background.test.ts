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

  it('audio in another tab of the scope holds off the prompt', async () => {
    const h = await startBackground({
      url: outsideUrl,
      mode: 'all-except-audio',
      extraTabs: [
        { id: 2, windowId: 1, active: false, url: protectedUrl },
        {
          id: 3,
          windowId: 1,
          active: false,
          url: 'https://example.com/protected/radio',
          audible: true,
        },
      ],
      session: {
        tabUrlMap: {
          1: outsideUrl,
          2: protectedUrl,
          3: 'https://example.com/protected/radio',
        },
        intentionScopePerTabId: { 2: 'rule-1', 3: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 1 },
        lastKnownWindowId: 1,
      },
    });
    // The scope is overdue, but something in it is still playing - in a
    // different tab than the one being opened.
    vi.setSystemTime(102000);
    await h.browser.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    expect(h.redirects).toEqual([]);
  });

  it('a muted tab is not audio, so the overdue prompt stands', async () => {
    const h = await startBackground({
      url: outsideUrl,
      mode: 'all-except-audio',
      extraTabs: [
        { id: 2, windowId: 1, active: false, url: protectedUrl },
        {
          id: 3,
          windowId: 1,
          active: false,
          url: 'https://example.com/protected/radio',
          audible: true,
          mutedInfo: { muted: true },
        },
      ],
      session: {
        tabUrlMap: {
          1: outsideUrl,
          2: protectedUrl,
          3: 'https://example.com/protected/radio',
        },
        intentionScopePerTabId: { 2: 'rule-1', 3: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 1 },
        lastKnownWindowId: 1,
      },
    });
    vi.setSystemTime(102000);
    await h.browser.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    expectPrompt(h);
  });

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

  it('a second window entering a scope is checked even when Chrome reports no focus', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      browserUnfocused: true,
      extraTabs: [{ id: 2, windowId: 2, active: true, url: 'about:blank' }],
    });
    // Nothing reports focused, so the only window we can name is the
    // remembered one - window 1, whose tab is already in the scope. That is
    // not evidence the user is in it, so the same-scope allowance must not
    // cover a navigation happening in window 2.
    await h.navigate(protectedUrl, 2);
    expectPrompt(h);
  });

  it('a new window Chrome is still handing focus to is the user’s own window', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [{ id: 2, windowId: 2, active: true, url: 'about:blank' }],
      focusedWindowIds: [1, 2],
    });
    // Window 2 just opened and Chrome has named it, but window 1 has not
    // reported its focus loss yet, so both read as focused. Asking "which
    // window is focused" can answer with either; the question that matters is
    // whether window 2 is, since that is where the user just acted.
    await h.browser.windows.onFocusChanged.emit(2);
    await h.browser.tabs.onActivated.emit({ tabId: 2, windowId: 2 });
    await h.navigate(protectedUrl, 2);
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

  it('an inactivity check that beats the settings load still prompts', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      deferSettings: true,
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 1 },
        lastKnownWindowId: 1,
      },
    });
    vi.setSystemTime(102000);
    // The restarted worker is still holding the default mode here.
    const checked = h.browser.runtime.onMessage.emit(
      { type: 'e2e:forceInactivityCheck-idle' },
      {},
      () => {}
    );
    h.releaseSettings();
    await h.started;
    await checked;
    expectPrompt(h);
  });

  it('a restarted worker keeps the predecessor the session recorded', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [{ id: 2, windowId: 1, active: false, url: outsideUrl }],
      session: {
        tabUrlMap: { 1: protectedUrl, 2: outsideUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 2 },
        lastKnownWindowId: 1,
      },
    });
    vi.setSystemTime(102000);
    // The browser already reports tab 1 active - it is the activation that
    // woke the worker, not the tab the user came from.
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expectPrompt(h);
  });

  it('a focus event missed while the worker was dead does not mute the check', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [{ id: 2, windowId: 1, active: false, url: outsideUrl }],
      session: {
        tabUrlMap: { 1: protectedUrl, 2: outsideUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 2 },
      },
    });
    await h.focus(-1);
    // Chrome regains focus while nobody is listening, so no event arrives.
    h.windows[0].focused = true;
    vi.setSystemTime(102000);
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expectPrompt(h);
  });

  it('a restarted worker keeps the focused window Chrome stops reporting', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      browserUnfocused: true,
      extraTabs: [{ id: 2, windowId: 1, active: false, url: outsideUrl }],
      session: {
        tabUrlMap: { 1: protectedUrl, 2: outsideUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 2 },
        lastKnownWindowId: 1,
      },
    });
    vi.setSystemTime(102000);
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expectPrompt(h);
  });

  it('a suspending worker drops the clock of a scope no tab is in', async () => {
    const h = await startBackground({
      url: outsideUrl,
      mode: 'all',
      session: {
        tabUrlMap: { 1: outsideUrl },
        lastActiveByScope: { 'rule-1': 90000 },
        lastKnownWindowId: 1,
      },
    });
    // Nothing is in rule-1 any more, so its clock would only ever be read
    // back as a stale reason to prompt.
    await h.browser.runtime.onSuspend.emit();
    expect(h.session.lastActiveByScope).toEqual({});
  });

  it('a suspending worker keeps the clock of a scope still open', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastKnownWindowId: 1,
      },
    });
    await h.browser.runtime.onSuspend.emit();
    expect(h.session.lastActiveByScope).toEqual({ 'rule-1': 90000 });
    expect(h.session.lastKnownWindowId).toBe(1);
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

describe('worker restart reconciliation', () => {
  it('a scope the session already timed does not get its clock reset', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 2 },
        lastKnownWindowId: 1,
      },
    });
    // Only 500ms after startup, so a clock reset at startup would read as
    // active and the prompt would be lost. It is the session's 90000 that
    // makes this overdue.
    vi.setSystemTime(100500);
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expectPrompt(h);
  });

  it('a scope the session never timed starts its clock at startup', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveTabIdByWindow: { 1: 2 },
        lastKnownWindowId: 1,
      },
    });
    // Startup gives the unknown scope a clock. Without one it would have no
    // last-active time at all, and an untimed scope never prompts - so the
    // prompt here is what proves the clock was started.
    vi.setSystemTime(102000);
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expectPrompt(h);
  });

  it('a cold start with no session seeds the window from the active tab', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [{ id: 2, windowId: 1, active: false, url: outsideUrl }],
    });
    // Nothing was hydrated, so tab 1 is the window's known active tab. A
    // re-activation of it is spurious and must not count as arriving.
    vi.setSystemTime(102000);
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expect(h.redirects).toEqual([]);
  });

  it('reconciliation drops tabs that closed while the worker was dead', async () => {
    const h = await startBackground({
      url: outsideUrl,
      mode: 'all',
      session: {
        tabUrlMap: { 1: outsideUrl, 7: protectedUrl },
        intentionScopePerTabId: { 7: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 7 },
        lastKnownWindowId: 1,
      },
    });
    vi.setSystemTime(102000);
    // Tab 7 no longer exists, so it cannot still be the window's active tab
    // and its scope mapping must be gone.
    expect(h.session.lastActiveTabIdByWindow).toEqual({});
    expect(h.session.tabUrlMap).toEqual({ 1: outsideUrl });
    expect(h.session.intentionScopePerTabId).toEqual({});
  });

  it('falls back to the last focused window when Chrome reports none', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      browserUnfocused: true,
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 2 },
      },
    });
    // No window reports focused and the session carries no focus either, so
    // only windows.getLastFocused can say where the user was.
    vi.setSystemTime(102000);
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expectPrompt(h);
  });

  it('a browser with no window left leaves focus unknown', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      browserUnfocused: true,
      lastFocusedWindow: null,
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 2 },
      },
    });
    vi.setSystemTime(102000);
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expect(h.redirects).toEqual([]);
  });

  it('a background window keeps its own last-active tab', async () => {
    const h = await startBackground({
      url: outsideUrl,
      mode: 'all',
      extraTabs: [
        { id: 2, windowId: 2, active: false, url: outsideUrl },
        { id: 3, windowId: 2, active: true, url: protectedUrl },
      ],
    });
    // Window 2 is not the focused one, so only reconciliation can learn
    // which of its tabs the user was on - and it must be the active one.
    expect(h.session.lastActiveTabIdByWindow).toEqual({ 1: 1, 2: 3 });
  });

  it('a window focused in a previous worker life is not one we saw focused', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      browserUnfocused: true,
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 1 },
        // Written by the worker life before this one. It says where the user
        // was, not that this worker ever watched focus arrive there.
        lastKnownWindowId: 1,
        // The key a pre-upgrade worker life wrote. It must not come back as
        // live focus either, however it is spelled.
        lastFocusedWindowId: 1,
      },
    });
    // Restarted while Chrome was in the background, so no focus event was
    // delivered. Coming back must still run the inactivity check: a window
    // only read out of storage cannot be the window focus just came from, and
    // letting it try makes the tab being returned to the tab it came from -
    // identical scopes, same-scope fast path, no check.
    vi.setSystemTime(102000);
    await h.focus(1);
    expectPrompt(h);
  });

  it('a page advancing its own history while Chrome is away is not activity', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      browserUnfocused: true,
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 1 },
      },
    });
    // Chrome is not the foreground application, so nothing here is the user.
    // A page that calls history.replaceState on a timer must not refresh the
    // clock, or the prompt that was already overdue never arrives.
    vi.setSystemTime(101500);
    await h.history(`${protectedUrl}?page=2`);
    vi.setSystemTime(102000);
    await h.focus(1);
    expectPrompt(h, `${protectedUrl}?page=2`);
  });
});

describe('leaving and returning to the browser', () => {
  it('losing focus starts the clock on the scope being left', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    vi.setSystemTime(105000);
    // Leaving records when the user left; coming back 2s later is 2s away,
    // not 7s, so the prompt is due relative to the departure.
    await h.focus(-1);
    vi.setSystemTime(107000);
    await h.focus(1);
    expectPrompt(h);
  });

  it('a brief flick away from the browser is not time away', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    vi.setSystemTime(105000);
    await h.focus(-1);
    vi.setSystemTime(105200);
    await h.focus(1);
    expect(h.redirects).toEqual([]);
  });

  it('losing focus is not itself an arrival to check', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 1 },
        lastKnownWindowId: 1,
      },
    });
    vi.setSystemTime(102000);
    await h.focus(-1);
    expect(h.redirects).toEqual([]);
  });

  it('the window the user is in survives a worker restart', async () => {
    const h = await startBackground({ url: outsideUrl, mode: 'all' });
    // Only the remembered window is persisted, and it has to survive the user
    // leaving: that is what tells the next worker life where they were, and a
    // wrong answer there makes it treat their next tab switch as bookkeeping.
    await h.focus(-1);
    expect(h.session.lastKnownWindowId).toBe(1);
    await h.focus(1);
    expect(h.session.lastKnownWindowId).toBe(1);
    // Live focus is deliberately not persisted. Reading it back would make a
    // remembered window answer "which window did focus just come from?".
    expect(h.session.lastFocusedWindowId).toBeUndefined();
  });

  it('coming back after a restart that never saw the user leave still prompts', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      // The worker died while Chrome was in the background, so it never heard
      // the focus leave and has no lastFocusedWindowId to hydrate. All it can
      // recover is where the user was, which is not the same claim.
      browserUnfocused: true,
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 1 },
      },
    });
    // Returning to the very tab they left, well past the timeout. If the
    // remembered window is allowed to stand in for the window being departed,
    // the from-tab and the arriving tab are the same tab, the scopes match,
    // and the same-scope fast path skips the check the user is owed.
    vi.setSystemTime(102000);
    await h.focus(1);
    expectPrompt(h);
  });

  it('leaving a window re-reads its active tab when the remembered one is unscoped', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [
        // Still open, so reconciliation keeps the mapping that names it - but
        // it is in no scope, which is the other reason to go and look again.
        { id: 3, windowId: 1, active: false, url: outsideUrl },
        { id: 2, windowId: 2, active: true, url: 'about:blank' },
      ],
      session: {
        tabUrlMap: { 1: protectedUrl, 3: outsideUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 3 },
        lastKnownWindowId: 1,
      },
    });
    vi.setSystemTime(100500);
    await h.focus(2);
    // Only the re-read writes window 1's tab; the focus handler writes window 2.
    expect(h.session.lastActiveTabIdByWindow).toMatchObject({ 1: 1 });
  });

  it('leaving a window that is in no scope records nothing', async () => {
    const h = await startBackground({
      url: outsideUrl,
      mode: 'all',
      session: {
        tabUrlMap: { 1: outsideUrl },
        lastActiveTabIdByWindow: { 1: 1 },
        lastKnownWindowId: 1,
      },
    });
    vi.setSystemTime(102000);
    await h.focus(-1);
    expect(h.session.lastActiveByScope).toEqual({});
  });

  it('leaving a window re-reads its active tab when the cache went stale', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [{ id: 2, windowId: 2, active: true, url: outsideUrl }],
      session: {
        tabUrlMap: { 1: protectedUrl },
        intentionScopePerTabId: { 1: 'rule-1' },
        lastActiveByScope: { 'rule-1': 90000 },
        lastActiveTabIdByWindow: { 1: 9 },
        lastKnownWindowId: 1,
      },
    });
    // Tab 9 is gone, so the window being left has no remembered tab.
    // Re-reading its active tab is the only way to record that the user was
    // in the protected scope right up to the moment they switched away.
    vi.setSystemTime(100500);
    await h.focus(2);
    expect(h.session.lastActiveTabIdByWindow).toMatchObject({ 1: 1 });
    vi.setSystemTime(100800);
    await h.focus(1);
    expect(h.redirects).toEqual([]);
  });
});

describe('settings changes reach the worker', () => {
  it('turning inactivity on takes effect without a restart', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'off' });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    await h.changeSettings({ inactivityMode: 'all' });
    vi.setSystemTime(105000);
    await h.focus(-1);
    vi.setSystemTime(107000);
    await h.focus(1);
    expectPrompt(h);
  });

  it('turning inactivity off takes effect without a restart', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    await h.changeSettings({ inactivityMode: 'off' });
    vi.setSystemTime(105000);
    await h.focus(-1);
    vi.setSystemTime(107000);
    await h.focus(1);
    expect(h.redirects).toEqual([]);
  });

  it('a longer timeout takes effect without a restart', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    await h.changeSettings({ inactivityTimeoutMs: 60000 });
    vi.setSystemTime(105000);
    await h.focus(-1);
    vi.setSystemTime(107000);
    await h.focus(1);
    expect(h.redirects).toEqual([]);
  });

  it('OS idle detection follows the configured mode', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'off' });
    expect(h.idleListenerCount()).toBe(0);
    await h.changeSettings({ inactivityMode: 'all' });
    expect(h.idleListenerCount()).toBe(1);
    await h.changeSettings({ inactivityMode: 'off' });
    expect(h.idleListenerCount()).toBe(0);
  });

  it('the OS idle interval follows the configured timeout, with a floor', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    // Chrome rejects anything under 15s, so a 1s timeout still asks for 15.
    expect(h.idleIntervals).toEqual([15]);
    await h.changeSettings({ inactivityTimeoutMs: 120000 });
    expect(h.idleIntervals.at(-1)).toBe(120);
  });

  it('a new rule claims tabs already open on that site', async () => {
    const h = await startBackground({ url: 'https://late.org/page' });
    expect(h.session.intentionScopePerTabId).toEqual({});
    await h.changeRules([
      ...h.settings.intentions,
      { id: 'late-rule', url: 'late.org', phrase: 'Late intention' },
    ]);
    // The mapping is what a restarted worker reads back, so the claim has to
    // reach the session, not just the live index.
    expect(h.session.intentionScopePerTabId).toEqual({ 1: 'late-rule' });
  });

  it('a deleted rule releases the tabs it was claiming', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    expect(h.session.intentionScopePerTabId).toEqual({ 1: 'rule-1' });
    await h.changeRules([]);
    // Time away that would have prompted while the rule existed.
    vi.setSystemTime(105000);
    await h.focus(-1);
    vi.setSystemTime(107000);
    await h.focus(1);
    expect(h.redirects).toEqual([]);
  });
});

describe('tab lifecycle bookkeeping', () => {
  it('a closed tab stops being the window its scope was last active in', async () => {
    const h = await startBackground({
      url: protectedUrl,
      mode: 'all',
      extraTabs: [{ id: 2, windowId: 1, active: false, url: outsideUrl }],
    });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    await h.removeTab(1);
    expect(h.session.tabUrlMap).not.toHaveProperty('1');
    expect(h.session.intentionScopePerTabId).not.toHaveProperty('1');
    expect(h.session.lastActiveTabIdByWindow).toEqual({});
  });

  it('a tab opened straight onto a page is known before it navigates', async () => {
    const h = await startBackground({ url: outsideUrl, mode: 'all' });
    await h.browser.tabs.onCreated.emit({
      id: 5,
      windowId: 1,
      active: false,
      url: protectedUrl,
    });
    expect(h.session.tabUrlMap).toEqual({ 1: outsideUrl, 5: protectedUrl });
  });

  it('a tab opened with no URL yet is not cached as having one', async () => {
    const h = await startBackground({ url: outsideUrl, mode: 'all' });
    await h.browser.tabs.onCreated.emit({ id: 5, windowId: 1, active: false });
    expect(Object.keys(h.session.tabUrlMap!)).toEqual(['1']);
  });

  it('a replaced tab keeps the scope and URL of the tab it replaced', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    await h.replaceTab(9, 1);
    expect(h.session.tabUrlMap).toEqual({ 9: protectedUrl });
    expect(h.session.intentionScopePerTabId).toEqual({ 9: 'rule-1' });
    expect(h.session.lastActiveTabIdByWindow).toEqual({ 1: 9 });
  });

  it('a replacement inherits the scope rather than re-prompting', async () => {
    const h = await startBackground({ url: protectedUrl, mode: 'all' });
    await h.browser.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    await h.replaceTab(9, 1);
    vi.setSystemTime(100500);
    await h.browser.tabs.onActivated.emit({ tabId: 9, windowId: 1 });
    expect(h.redirects).toEqual([]);
  });
});

describe('window lifecycle bookkeeping', () => {
  it('closing a window drops the tab it was tracking', async () => {
    const h = await startBackground({
      url: outsideUrl,
      mode: 'all',
      extraTabs: [{ id: 2, windowId: 2, active: true, url: outsideUrl }],
    });
    await h.browser.windows.onRemoved.emit(2);
    expect(h.session.lastActiveTabIdByWindow).toEqual({ 1: 1 });
    expect(h.session.lastKnownWindowId).toBe(1);
  });

  it('closing the focused window leaves focus unknown', async () => {
    const h = await startBackground({ url: outsideUrl, mode: 'all' });
    await h.browser.windows.onRemoved.emit(1);
    expect(h.session.lastActiveTabIdByWindow).toEqual({});
    expect(h.session.lastKnownWindowId).toBe(null);
  });
});
