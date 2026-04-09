declare module 'talisman/metrics/damerau-levenshtein' {
  /**
   * Computes the Damerau-Levenshtein distance between two strings.
   * This is the minimum number of operations (insertions, deletions, substitutions, transpositions)
   * required to transform one string into another.
   *
   * @param a - The first string
   * @param b - The second string
   * @returns The Damerau-Levenshtein distance between the strings
   */
  function damerauLevenshtein(a: string, b: string): number;

  export default damerauLevenshtein;
}
