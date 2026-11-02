import { describe, expect, it } from 'vitest';
import {
  createIntentionIndex,
  isLanguageCode,
  lookupIntention,
  makeRawIntention,
  parseIntention,
  parseUrlToScope,
} from '../src/components/intention';
import { parseUrlString } from '../src/components/normalized-url';

function matches(scope: string, target: string): boolean {
  const intention = parseIntention(makeRawIntention(scope, 'test'));
  expect(intention, `Scope must be valid: ${scope}`).not.toBeNull();
  return lookupIntention(target, createIntentionIndex([intention!])) !== null;
}

describe('canonical URL matching', () => {
  it.each([
    ['bücher.de/books', 'https://xn--bcher-kva.de/books'],
    ['xn--bcher-kva.de/books', 'https://bücher.de/books'],
    ['example.com./events', 'https://example.com/events'],
    ['example.com/events', 'https://example.com./events'],
    ['example.com:8080/path', 'https://example.com:8080/path'],
    ['httpbin.co.uk/events', 'https://sv.httpbin.co.uk/events'],
    ['httpsite.co.uk/events', 'https://fr.httpsite.co.uk/events'],
  ])('matches %s to %s', (scope, target) => {
    expect(matches(scope, target)).toBe(true);
  });

  it('keeps registrable domain and multi-label suffix separate', () => {
    expect(parseUrlToScope('httpbin.co.uk')).toMatchObject({
      domain: 'httpbin',
      publicSuffix: 'co.uk',
      subdomain: null,
    });
    expect(matches('httpbin.co.uk', 'https://cdn.httpbin.co.uk')).toBe(false);
    expect(matches('httpbin.co.uk', 'https://unrelated.co.uk')).toBe(false);
  });

  it.each([
    'ftp://example.com/path',
    'mailto:user@example.com',
    'javascript:example.com',
    'https://user:password@example.com',
    'user@example.com',
    'example.com:invalid/path',
    'http://localhost/path',
    'https://127.0.0.1/path',
    'https://example.invalid/path',
  ])('rejects unsupported or ambiguous URL %s', input => {
    expect(parseUrlString(input)).toBeNull();
  });
});

describe('language path scope', () => {
  it.each([
    ['example.com/en/events', 'example.com/fr/events/123'],
    ['example.com/fr/events', 'example.com/en/events/123'],
    ['example.com/en-us/events', 'example.com/fr-fr/events/123'],
  ])('matches translated paths %s to %s', (scope, target) => {
    expect(matches(scope, target)).toBe(true);
    expect(matches(scope, 'example.com/fr/unrelated')).toBe(false);
  });

  it.each(['en-us-news', 'fr-fr-events', 'en-us-', 'en-USA'])(
    'does not strip non-locale segment %s',
    segment => {
      expect(isLanguageCode(segment)).toBe(false);
      expect(
        matches(`example.com/${segment}/events`, 'example.com/events')
      ).toBe(false);
      expect(
        matches('example.com/events', `example.com/${segment}/events`)
      ).toBe(false);
      expect(
        matches(
          `example.com/${segment}/events`,
          `example.com/${segment}/events/1`
        )
      ).toBe(true);
    }
  );

  it.each(['en', 'fr', 'en-US', 'pt-br'])(
    'still recognizes locale %s',
    locale => {
      expect(isLanguageCode(locale)).toBe(true);
    }
  );
});
