import { describe, expect, it } from 'vitest';
import {
  parseSettingsImport,
  parseTimeoutMinutesInput,
} from '../src/components/settings-data';

describe('settings import validation', () => {
  it.each(
    [
      null,
      12,
      'settings',
      {},
      { invalid: 'json' },
      { intentions: null },
      [{ url: 123, phrase: 'test' }],
      [{ url: 'example.com', phrase: null }],
      [null],
      [{}],
      { intentions: [], fuzzyMatching: 'false' },
      { intentions: [], showAdvancedSettings: 1 },
      { intentions: [], canCopyIntentionText: null },
      { intentions: [], directToSettings: [] },
      { intentions: [], debugLogging: {} },
      { intentions: [], inactivityMode: 'never' },
      { intentions: [], breathAnimationIntensity: 'extreme' },
      ...[0, -1, Infinity, NaN, '100'].map(value => ({
        intentions: [],
        inactivityTimeoutMs: value,
      })),
    ].map(value => ({ value }))
  )('rejects the whole malformed payload: %j', ({ value }) => {
    expect(() => parseSettingsImport(value)).toThrow();
  });

  it('imports legacy drafts without requiring a complete URL and regenerates duplicate IDs', () => {
    const input = [
      { id: 'duplicate', url: 'example.com', phrase: 'Read something' },
      { id: 'duplicate', url: '', phrase: 'unfinished draft' },
    ];
    const result = parseSettingsImport(input);
    expect(
      result.intentions.map(({ url, phrase }) => ({ url, phrase }))
    ).toEqual([
      { url: 'example.com', phrase: 'Read something' },
      { url: '', phrase: 'unfinished draft' },
    ]);
    expect(new Set(result.intentions.map(row => row.id)).size).toBe(2);
    expect(result.intentions.every(row => row.id !== 'duplicate')).toBe(true);
    expect(input[0].id).toBe('duplicate');
  });

  it.each([{ value: [] }, { value: { intentions: [], version: '0.6.0' } }])(
    'allows an intentional empty import: %j',
    ({ value }) => {
      expect(parseSettingsImport(value)).toEqual({ intentions: [] });
    }
  );

  it('keeps every recognized setting, ignoring metadata and unknown keys at every level', () => {
    const value = JSON.parse(
      '{"intentions":[{"id":"old","url":"example.com/path","phrase":"Read","extra":42}],"fuzzyMatching":false,"inactivityMode":"all","inactivityTimeoutMs":1234,"showAdvancedSettings":true,"canCopyIntentionText":true,"breathAnimationIntensity":"heavy","directToSettings":true,"debugLogging":true,"version":"future","unknown":1,"__proto__":{"polluted":true}}'
    );
    const result = parseSettingsImport(value);
    expect(result).toEqual({
      intentions: [
        { id: expect.any(String), url: 'example.com/path', phrase: 'Read' },
      ],
      fuzzyMatching: false,
      inactivityMode: 'all',
      inactivityTimeoutMs: 1234,
      showAdvancedSettings: true,
      canCopyIntentionText: true,
      breathAnimationIntensity: 'heavy',
      directToSettings: true,
      debugLogging: true,
    });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe('manual timeout entry', () => {
  it.each([
    { text: '-10', minutes: 1 },
    { text: '0', minutes: 1 },
    { text: '900', minutes: 480 },
    { text: '15', minutes: 15 },
    { text: '', minutes: 30 },
    { text: 'invalid', minutes: 30 },
    { text: '9'.repeat(400), minutes: 30 },
  ])('keeps "$text" within the editor range', ({ text, minutes }) => {
    expect(parseTimeoutMinutesInput(text)).toBe(minutes);
  });
});
