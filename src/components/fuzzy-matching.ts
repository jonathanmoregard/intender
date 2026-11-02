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

  // Compare Unicode code points so a non-BMP character is one edit, just as
  // an ordinary letter is, in both complete and partial phrase matching.
  const distance = damerauLevenshtein(Array.from(input), Array.from(expected));
  return distance <= maxDistance;
}

/**
 * Fuzzy matches input against any prefix of the expected phrase. Insertions
 * and deletions can shift the prefix boundary away from the input's length.
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

  if (!(maxDistance >= 0)) return false;
  if (expected.startsWith(input)) return true;

  const inputCharacters = Array.from(input);
  const expectedCharacters = Array.from(expected);
  const budget = Math.floor(maxDistance);
  // Length difference alone rules out all prefixes outside this window.
  const first = Math.max(0, inputCharacters.length - budget);
  const last = Math.min(
    expectedCharacters.length,
    inputCharacters.length + budget
  );

  for (let length = first; length <= last; length++) {
    const distance = damerauLevenshtein(
      inputCharacters,
      expectedCharacters.slice(0, length)
    );
    if (distance <= maxDistance) return true;
  }
  return false;
}
