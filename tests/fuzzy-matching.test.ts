import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  fuzzyMatch,
  fuzzyPartialMatch,
} from '../src/components/fuzzy-matching';

describe('fuzzyMatch', () => {
  const expected = 'I want to check my email';
  const maxDistance = 2;

  it('should match exact phrases', () => {
    const result = fuzzyMatch(
      'I want to check my email',
      expected,
      maxDistance
    );

    expect(result).toBe(true);
  });

  it('should match with typos', () => {
    const result = fuzzyMatch('I want to chek my email', expected, maxDistance);

    expect(result).toBe(true);
  });

  it('should match with missing spaces', () => {
    const result = fuzzyMatch('I want tocheck my email', expected, maxDistance);

    expect(result).toBe(true);
  });

  it('should not match completely different phrases', () => {
    const result = fuzzyMatch(
      'completely different phrase',
      expected,
      maxDistance
    );

    expect(result).toBe(false);
  });

  it('should not match very short inputs', () => {
    const result = fuzzyMatch('I', expected, maxDistance);

    expect(result).toBe(false);
  });

  it('should handle empty input', () => {
    const result = fuzzyMatch('', expected, maxDistance);

    expect(result).toBe(false);
  });

  it('should handle empty expected phrase', () => {
    const result = fuzzyMatch('I want to check my email', '', maxDistance);

    expect(result).toBe(false);
  });
});

describe('fuzzyPartialMatch', () => {
  const maxDistance = 2;

  const phraseArb = fc
    .array(fc.constantFrom('a', 'b', 'c', 'd'), {
      minLength: 3,
      maxLength: 40,
    })
    .map(characters => characters.join(''));

  it('keeps matching when correct characters follow inserted or deleted characters', () => {
    fc.assert(
      fc.property(phraseArb, fc.nat(), (expected, position) => {
        const end = 3 + (position % (expected.length - 2));
        const prefix = expected.slice(0, end);
        const nextCharacter = expected.slice(end, end + 1);
        // Track the expected boundary, not the typo-shifted input length.
        for (const input of [`xx${prefix}`, prefix.slice(2)]) {
          expect(fuzzyPartialMatch(input, expected, maxDistance)).toBe(true);
          expect(
            fuzzyPartialMatch(input + nextCharacter, expected, maxDistance)
          ).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('matches every nonempty exact prefix without consuming the edit budget', () => {
    fc.assert(
      fc.property(phraseArb, expected => {
        for (let length = 1; length <= expected.length; length++) {
          expect(
            fuzzyPartialMatch(expected.slice(0, length), expected, 0)
          ).toBe(true);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('should handle the specific example case', () => {
    const expected = 'I want to use events/chat, and have set a 5 minute timer';

    // Test: if "I wna" is OK, then "I wnat" should also be OK
    const input1 = 'I wna';
    const input2 = 'I wnat';

    const result1 = fuzzyPartialMatch(input1, expected, maxDistance);
    const result2 = fuzzyPartialMatch(input2, expected, maxDistance);

    expect(result1).toBe(true);
    expect(result2).toBe(true);
  });
});
