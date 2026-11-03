/**
 * URL normalization and parsing utilities for the Intender extension.
 */

import normalizeUrlLib from 'normalize-url';
import { parse } from 'tldts';
import { Brand } from 'ts-brand';

// Branded type for validated normalized URLs
export type NormalizedUrl = Brand<string, 'NormalizedUrl'>;

/**
 * Normalizes a URL object
 * - Strip protocol (http://, https://)
 * - Remove query parameters and hash fragments
 * - Lowercase the entire string
 * - Strip www subdomains
 * @param url - The parsed URL object to normalize
 * @returns Normalized URL as NormalizedUrl
 */
export function normalizeUrl(url: URL): NormalizedUrl {
  const normalized = normalizeUrlLib(url.toString(), {
    stripProtocol: true,
    stripWWW: true,
    removeQueryParameters: true,
    stripHash: true,
    removeTrailingSlash: true,
    removeSingleSlash: true,
  });

  return normalized as NormalizedUrl;
}

/**
 * Converts a normalized URL into components for matching.
 */
export function toComponents(normalizedUrl: NormalizedUrl): {
  domain: string;
  publicSuffix: string;
  subdomain: string | null;
  path: string;
} {
  // normalizeUrl always produces a protocol-free URL. Parse it consistently,
  // including hosts beginning with "http" and multi-label public suffixes.
  const parsedUrl = new URL(`https://${normalizedUrl}`);
  const { domainWithoutSuffix, publicSuffix, subdomain } = parse(
    parsedUrl.hostname
  );

  return {
    domain: domainWithoutSuffix || '',
    publicSuffix: publicSuffix || '',
    subdomain: subdomain || null,
    path: parsedUrl.pathname === '/' ? '' : parsedUrl.pathname,
  };
}

/**
 * Parses a URL string and returns a URL object if valid.
 * Uses tldts for domain validation and parsing.
 */
export function parseUrlString(input: string): URL | null {
  const trimmed = input.trim();
  // A host followed by a numeric port is not a URL scheme. Require explicit
  // HTTP(S) schemes to include their authority separator; reject other schemes.
  const hasHttpScheme = /^https?:\/\//i.test(trimmed);
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
  const hasHostPort = /^[^/:?#]+:\d+(?:[/?#]|$)/.test(trimmed);
  if (hasScheme && !hasHttpScheme && !hasHostPort) return null;

  try {
    const url = new URL(hasHttpScheme ? trimmed : `https://${trimmed}`);
    if (url.username || url.password) return null;

    // Validate the browser's canonical hostname, so IDNs and trailing root
    // dots use the same domain interpretation throughout parsing and matching.
    const parsed = parse(url.hostname, { allowPrivateDomains: false });
    if (!parsed.isIcann || !parsed.domain) return null;
    return url;
  } catch {
    return null;
  }
}
