/**
 * Helper functions for functional programming patterns.
 */

/**
 * Filters out null values from an array.
 * Similar to Haskell's fromMaybes but for null instead of Maybe.
 *
 * @param array - Array that may contain null values
 * @returns Array with null values removed
 */
export function fromNulls<T>(array: (T | null)[]): T[] {
  return array.filter((item): item is T => item !== null);
}

/**
 * Maps over an array and filters out null results.
 * Similar to Haskell's mapMaybe but for null instead of Maybe.
 *
 * @param fn - Function that may return null
 * @param array - Array to map over
 * @returns Array with null results filtered out
 */
export function mapNulls<T, U>(fn: (item: T) => U | null, array: T[]): U[] {
  return Array.from(
    (function* () {
      for (const item of array) {
        const mapped = fn(item);
        if (mapped !== null) {
          yield mapped;
        }
      }
    })()
  );
}
