import damerauLevenshtein from 'talisman/metrics/damerau-levenshtein';

/**
 * Fuzzy matches an input string against an expected string using Damerau-Levenshtein distance
 * @param input - The input string to match
 * @param expected - The expected string to match against
 * @param maxDistance - Maximum allowed edit distance
 * @returns true if there's a good fuzzy match, false otherwise
 */
export function fuzzyMatch(
  input: string,
  expected: string,
  maxDistance: number
): boolean {
  if (!input.trim() || !expected.trim()) return false;

  const distance = damerauLevenshtein(input, expected);
  return distance <= maxDistance;
}

/**
 * Fuzzy matches an input string against a truncated portion of an expected string
 * This ensures monotonicity: adding correct characters should never make the match worse
 * @param input - The input string to match
 * @param expected - The full expected string
 * @param maxDistance - Maximum allowed edit distance for partial matches
 * @returns true if there's a good fuzzy match against the truncated portion
 */
export function fuzzyPartialMatch(
  input: string,
  expected: string,
  maxDistance: number
): boolean {
  if (!input.trim() || !expected.trim()) return false;

  const prefix = expected.slice(0, input.length);
  const distance = damerauLevenshtein(input, prefix);
  return distance <= maxDistance;
}
