import { describe, expect, it } from 'vitest';
import {
  fuzzyMatch,
  fuzzyPartialMatch,
} from '../src/components/fuzzy-matching';

describe('fuzzy prefix edit alignment', () => {
  it.each([
    ['Ixx want', 'I want to check email', 2, true],
    ['I wt to', 'I want to check email', 2, true],
    ['I wnat', 'I want to check email', 1, true],
    ['Ixxx want', 'I want to check email', 2, false],
    ['check email', 'I want to check email', 2, false],
    ['emailxxx', 'email', 2, false],
    ['emailxx', 'email', 2, true],
    ['', 'email', 2, false],
    ['   ', 'email', 2, false],
    ['email', '', 2, false],
    ['I want', 'I want to check email', 0, true],
    ['I wxnt', 'I want to check email', 0, false],
  ])(
    'compares %j to an expected prefix of %j within %i edits',
    (input, expected, distance, result) => {
      expect(fuzzyPartialMatch(input, expected, distance)).toBe(result);
    }
  );

  it('accepts each subsequent correct character after inserted typos', () => {
    const expected = 'I want to check email';
    for (let end = 6; end <= expected.length; end++) {
      expect(
        fuzzyPartialMatch(`Ixx${expected.slice(1, end)}`, expected, 2)
      ).toBe(true);
    }
    expect(fuzzyMatch('Ixx want to check email', expected, 2)).toBe(true);
  });

  it.each([
    ['I😀 want', 'I want to check email', 1],
    ['😀😃 want', '😃😀 want to check email', 1],
  ])(
    'counts Unicode characters consistently for partial and full matches',
    (input, expected, distance) => {
      expect(fuzzyPartialMatch(input, expected, distance)).toBe(true);
      expect(fuzzyMatch(`${input} to check email`, expected, distance)).toBe(
        true
      );
    }
  );
});
