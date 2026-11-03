/**
 * Intention data structures and URL matching logic for the Intender extension.
 *
 * This module implements the URL matching specification that provides intuitive,
 * performant, language-aware matching for intention URLs.
 */

import countries from 'i18n-iso-countries';
import ISO6391 from 'iso-639-1';
import { Brand } from 'ts-brand';
import { normalizeUrl, parseUrlString, toComponents } from './normalized-url';
import { UUID, generateUUID } from './uuid';

// ============================================================================
// TYPES
// ============================================================================

// Branded type for intention index
export type IntentionIndex = Brand<
  Map<string, { scope: IntentionScope; intention: Intention }[]>,
  'IntentionIndex'
>;

// Branded type for intention scope ID
export type IntentionScopeId = Brand<UUID, 'IntentionScopeId'>;

/**
 * Converts an Intention to an IntentionScopeId.
 * Uses the intention's UUID as the IntentionScopeId.
 */
export function intentionToIntentionScopeId(
  intention: Intention
): IntentionScopeId {
  return intention.id as IntentionScopeId;
}

export interface IntentionScope {
  domain: string; // e.g. "facebook"
  publicSuffix: string; // e.g. "com", "se", "co.uk"
  subdomain: string | null; // e.g. "sv", "mail" or null
  path: string; // e.g. "/groups/foo", may be ""
  urlLength: number; // length of the full normalized string
  hasLanguageSuffix: boolean; // true if publicSuffix is a language-specific TLD
  hasLanguageSubdomain: boolean; // true if subdomain is a language code
  hasLanguagePathStart: boolean; // true if path starts with a language code
  originalUrl: string; // the original URL string that was parsed
}

export interface Intention {
  id: UUID; // UUID for unique identification
  scope: IntentionScope;
  phrase: string;
}

export interface RawIntention {
  id: UUID;
  url: string;
  phrase: string;
}

export function emptyRawIntention(): RawIntention {
  return { id: generateUUID(), url: '', phrase: '' };
}

export function makeRawIntention(url: string, phrase: string): RawIntention {
  return { id: generateUUID(), url, phrase };
}

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

/**
 * Checks if a string is a recognized language code.
 * Uses ISO 639-1 library for language codes and i18n-iso-countries for country codes.
 */
export function isLanguageCode(code: string): boolean {
  const lowerCode = code.toLowerCase();

  // Check if it's a simple language code (e.g., 'en', 'fr')
  if (ISO6391.validate(lowerCode)) {
    return true;
  }

  // Check if it's a language-country combination (e.g., 'en-us', 'fr-fr')
  if (/^[a-z]{2}-[a-z]{2}$/.test(lowerCode)) {
    const [lang, country] = lowerCode.split('-');
    return ISO6391.validate(lang) && countries.isValid(country.toUpperCase());
  }

  return false;
}

/**
 * Checks if a public suffix contains language information using i18n-iso-countries.
 * Uses the official country code list to determine language-specific TLDs.
 */
export function isLanguageSuffix(suffix: string): boolean {
  // Get all country codes from i18n-iso-countries
  const countryCodes = Object.keys(countries.getAlpha2Codes());

  // Check if suffix matches a country code (common pattern for ccTLDs)
  // Convert to uppercase for comparison since country codes are uppercase
  return countryCodes.includes(suffix.toUpperCase());
}

/**
 * Extracts language part from a path if present using URLPattern.
 * Returns the language code and the remaining path.
 */
export function extractLanguageFromPath(path: string): {
  language: string | null;
  remainingPath: string;
} {
  const match = path.match(/^\/([^\/]+)(\/.*)?$/);
  if (!match) return { language: null, remainingPath: path };

  const [, firstSegment, rest = ''] = match;

  if (isLanguageCode(firstSegment)) {
    return {
      language: firstSegment,
      remainingPath: rest || '',
    };
  }

  return { language: null, remainingPath: path };
}

// ============================================================================
// PATH SCOPE
// ============================================================================

/**
 * What an intention's path claims about which URLs it covers.
 *
 * These are two different claims and must not share a representation. Covering
 * the whole site is a decision, and it should be visible as one. The empty
 * string used to express it twice over - directly, as "no path", and
 * indirectly, because `startsWith('')` is true of every URL - so the second
 * route was reachable by accident, from any path that stripped down to
 * nothing. The non-empty constraint on `prefixes` closes that route: an empty
 * prefix can no longer reach `startsWith`, so site-wide matching is only ever
 * the `whole-site` case, chosen on purpose in `pathScopeOf`.
 */
export type PathScope =
  | { kind: 'whole-site' }
  | { kind: 'prefixes'; prefixes: [string, ...string[]] };

/**
 * Reads an intention's path as the claim it makes.
 *
 * A locale is noise here: it is stripped from both sides, so `/en/news` and
 * `/news` are the same page in two languages. A path that is *only* a locale
 * is therefore the site's localized front door - the root - and the root
 * covers the site. `example.com/en` and `example.com` mean the same thing.
 *
 * The consequence to know about is that `isLanguageCode` is generous: `my`,
 * `it`, `no`, `is`, `to` and `am` are all ISO 639-1 codes, so `company.com/my`
 * is read as a locale and covers all of `company.com`. That is a question
 * about which segments count as locales, not about this function.
 */
export function pathScopeOf(path: string): PathScope {
  if (!path) return { kind: 'whole-site' };
  const { remainingPath } = extractLanguageFromPath(path);
  if (!remainingPath) return { kind: 'whole-site' };
  const prefixes: [string, ...string[]] =
    remainingPath !== path ? [path, remainingPath] : [path];
  return { kind: 'prefixes', prefixes };
}

// ============================================================================
// INTENTION PARSING
// ============================================================================

/**
 * Parses a URL string into an IntentionScope for matching.
 */
export function parseUrlToScope(urlString: string): IntentionScope | null {
  const parsedUrl = parseUrlString(urlString);
  if (!parsedUrl) {
    return null;
  }
  const normalizedUrl = normalizeUrl(parsedUrl);
  const { domain, publicSuffix, subdomain, path } = toComponents(normalizedUrl);

  // Check for language parts
  const hasLanguageSubdomain = subdomain ? isLanguageCode(subdomain) : false;
  const hasLanguageSuffix = isLanguageSuffix(publicSuffix);
  const { language: pathLanguage } = extractLanguageFromPath(path);
  const hasLanguagePathStart = pathLanguage !== null;

  return {
    domain,
    publicSuffix,
    subdomain,
    path,
    urlLength: normalizedUrl.length,
    hasLanguageSuffix,
    hasLanguageSubdomain,
    hasLanguagePathStart,
    originalUrl: urlString,
  };
}

/**
 * Converts a Intention to RawIntention
 */
export function parsedIntentionToRaw(intention: Intention): RawIntention {
  return {
    id: intention.id,
    url: intention.scope.originalUrl,
    phrase: intention.phrase,
  };
}

/**
 * Attempts to convert a RawIntention to Intention.
 * Returns null if the URL cannot be parsed.
 */
export function parseIntention(raw: RawIntention): Intention | null {
  const scope = parseUrlToScope(raw.url);
  if (!scope) {
    return null;
  }
  return {
    id: raw.id,
    scope,
    phrase: raw.phrase,
  };
}

/**
 * Checks if a RawIntention can be parsed successfully.
 */
export function canParseIntention(raw: RawIntention): boolean {
  return parseUrlToScope(raw.url) !== null;
}

/**
 * Checks if an intention is empty (no meaningful content).
 */
export function isEmpty(intention: RawIntention): boolean {
  return (
    (!intention.url || intention.url.trim() === '') &&
    (!intention.phrase || intention.phrase.trim() === '')
  );
}

/**
 * Checks if a phrase is empty (no meaningful content).
 */
export function isPhraseEmpty(phrase: string): boolean {
  return !phrase || phrase.trim() === '';
}

// ============================================================================
// INTENTION INDEXING AND LOOKUP
// ============================================================================

/**
 * Creates an index for fast intention lookup by domain.
 */
export function createIntentionIndex(intentions: Intention[]): IntentionIndex {
  const index = new Map<
    string,
    { scope: IntentionScope; intention: Intention }[]
  >();

  for (const intention of intentions) {
    const { scope } = intention;
    const key = scope.domain;

    if (!index.has(key)) {
      index.set(key, []);
    }

    index.get(key)!.push({ scope, intention });
  }

  // Sort each domain's intentions by urlLength descending
  for (const [domain, intentionScopes] of index) {
    intentionScopes.sort((a, b) => b.scope.urlLength - a.scope.urlLength);
  }

  return index as IntentionIndex;
}

/**
 * Checks if a target URL matches an intention scope according to the matching rules.
 * Note: This function assumes the domain has already been matched.
 */
export function matchesIntentionScopeIgnoringDomain(
  targetUrl: string,
  intentionScope: IntentionScope
): boolean {
  const parsedUrl = parseUrlString(targetUrl);
  if (!parsedUrl) {
    return false;
  }
  const normalizedTarget = normalizeUrl(parsedUrl);
  const targetParts = toComponents(normalizedTarget);

  // Step 1: Public Suffix Match
  if (intentionScope.hasLanguageSuffix) {
    // If intention has language suffix, match any suffix
    // (no suffix check needed)
  } else {
    // If intention has non-language suffix, match same suffix OR any language suffix
    if (isLanguageSuffix(targetParts.publicSuffix)) {
      // Target has language suffix - always match
    } else {
      // Target has non-language suffix - must match intention suffix
      if (targetParts.publicSuffix !== intentionScope.publicSuffix) {
        return false;
      }
    }
  }

  // Step 2: Subdomain Match
  if (intentionScope.subdomain) {
    // If intention has subdomain, check if it's a language subdomain
    if (intentionScope.hasLanguageSubdomain) {
      // If intention has language subdomain, target can have:
      // - no subdomain
      // - same language subdomain
      // - different language subdomain
      if (targetParts.subdomain) {
        // Target has subdomain - must be a language subdomain
        if (!isLanguageCode(targetParts.subdomain)) {
          return false;
        }
      }
    } else {
      // If intention has non-language subdomain, target must match exactly
      if (targetParts.subdomain !== intentionScope.subdomain) {
        return false;
      }
    }
  } else {
    // If intention has no subdomain, target can have:
    // - no subdomain
    // - www subdomains (already stripped in normalization)
    // - language subdomains (stripped)
    if (targetParts.subdomain) {
      // Check if target subdomain is a language code
      if (!isLanguageCode(targetParts.subdomain)) {
        return false;
      }
    }
  }

  // Step 3: Path Match
  const pathScope = pathScopeOf(intentionScope.path);
  if (pathScope.kind === 'whole-site') return true;

  // Compare original and language-free paths on both sides. Keeping originals
  // preserves literal path-prefix matching when a segment is also a locale.
  const { remainingPath: targetPath } = extractLanguageFromPath(
    targetParts.path
  );
  return [targetParts.path, targetPath].some(target =>
    pathScope.prefixes.some(prefix => target.startsWith(prefix))
  );
}

/**
 * Fast lookup of matching intention using the domain index.
 */
export function lookupIntention(
  targetUrl: string,
  intentionIndex: IntentionIndex
): Intention | null {
  const targetScope = parseUrlToScope(targetUrl);
  if (!targetScope) {
    return null;
  }

  const key = targetScope.domain; // Use just the domain, not domain + suffix
  const intentions = intentionIndex.get(key);

  if (!intentions) {
    return null;
  }

  // Find the first matching intention (already sorted by urlLength descending)
  const match = intentions.find(({ scope }) =>
    matchesIntentionScopeIgnoringDomain(targetUrl, scope)
  );

  return match ? match.intention : null;
}

/**
 * Creates an empty IntentionScope with default values.
 */
export function createEmptyIntentionScope(): IntentionScope {
  return {
    domain: '',
    publicSuffix: '',
    subdomain: null,
    path: '',
    urlLength: 0,
    hasLanguageSuffix: false,
    hasLanguageSubdomain: false,
    hasLanguagePathStart: false,
    originalUrl: '',
  };
}

/**
 * Converts an IntentionScope to a display string.
 * tldts uses domain="registrableDomain" which includes the public suffix
 */
export function viewScope(scope: IntentionScope): string {
  if (!scope.domain) return '';
  const hostname = scope.subdomain
    ? `${scope.subdomain}.${scope.domain}`
    : `${scope.domain}`;
  return hostname + scope.path;
}
