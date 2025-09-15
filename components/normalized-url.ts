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
  try {
    // Add protocol if missing for URL constructor
    const urlWithProtocol = normalizedUrl.startsWith('http')
      ? normalizedUrl
      : `https://${normalizedUrl}`;

    const parsedUrl = new URL(urlWithProtocol);
    const { domainWithoutSuffix, publicSuffix, subdomain } = parse(
      parsedUrl.hostname
    );

    return {
      domain: domainWithoutSuffix || '',
      publicSuffix: publicSuffix || '',
      subdomain: subdomain || null,
      path: parsedUrl.pathname === '/' ? '' : parsedUrl.pathname,
    };
  } catch {
    // Fallback to manual parsing for edge cases
    const [hostAndPath, ...rest] = normalizedUrl.split('/');
    const path = rest.length > 0 ? '/' + rest.join('/') : '';

    const hostParts = hostAndPath.split('.');

    if (hostParts.length === 1) {
      return {
        domain: hostParts[0],
        publicSuffix: '',
        subdomain: null,
        path,
      };
    }

    if (hostParts.length === 2) {
      return {
        domain: hostParts[0],
        publicSuffix: hostParts[1],
        subdomain: null,
        path,
      };
    }

    const publicSuffix = hostParts[hostParts.length - 1];
    const domain = hostParts[hostParts.length - 2];
    const subdomain = hostParts.slice(0, -2).join('.');

    return {
      domain,
      publicSuffix,
      subdomain: subdomain || null,
      path,
    };
  }
}

/**
 * Parses a URL string and returns a URL object if valid.
 * Uses tldts for domain validation and parsing.
 */
export function parseUrlString(input: string): URL | null {
  const trimmed = input.trim();
  const parsed = parse(trimmed, { allowPrivateDomains: false });

  if (!parsed.isIcann || !parsed.domain) return null;

  let urlStr = trimmed;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    urlStr = 'https://' + trimmed;
  }

  try {
    const url = new URL(urlStr);
    if (!url.hostname || url.hostname !== parsed.hostname) return null;
    return url;
  } catch {
    return null;
  }
}
