import { faker } from '@faker-js/faker';
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

  // Function to inject typos into a string
  function withTypos(str: string, typoRate = 0.2): string {
    const chars = str.split('');
    const result: string[] = [];

    for (let i = 0; i < chars.length; i++) {
      if (Math.random() < typoRate) {
        const typoType = Math.floor(Math.random() * 4);
        switch (typoType) {
          case 0: // swap with next
            if (i < chars.length - 1) {
              result.push(chars[i + 1], chars[i]);
              i++; // skip next since we already used it
            } else {
              result.push(chars[i]);
            }
            break;
          case 1: // delete character
            // skip pushing this character
            break;
          case 2: // duplicate character
            result.push(chars[i], chars[i]);
            break;
          case 3: // replace with random letter
            const randChar = String.fromCharCode(
              97 + Math.floor(Math.random() * 26)
            );
            result.push(randChar);
            break;
        }
      } else {
        result.push(chars[i]);
      }
    }

    return result.join('');
  }

  it('should pass property: if n chars match, n+1 chars should match if next char is from expected', () => {
    // Property: adding a correct character should never turn from valid to invalid
    // Base lorem ipsum text
    const loremIpsum = faker.lorem.sentence();

    // Arbitrary that generates the same base text with typos
    const loremIpsumTyposArb = fc
      .constant(null)
      .map(() => withTypos(loremIpsum, 0.05)); // Much lower typo rate

    fc.assert(
      fc.property(loremIpsumTyposArb, inputWithTypos => {
        // Test the property: if input substring length works, then adding the next expected char should work
        const maxLength = Math.min(loremIpsum.length, inputWithTypos.length);

        for (let length = 3; length < maxLength; length++) {
          const currentInput = inputWithTypos.substring(0, length);
          const nextExpectedChar = loremIpsum.charAt(length);
          const nextInput = currentInput + nextExpectedChar; // Add next expected char to current input

          const currentMatches = fuzzyPartialMatch(
            currentInput,
            loremIpsum,
            maxDistance
          );
          const nextMatches = fuzzyPartialMatch(
            nextInput,
            loremIpsum,
            maxDistance
          );

          // If current matches, then adding the next expected char should also match
          if (currentMatches) {
            if (!nextMatches) {
              console.log(
                `Property violation: ${length} chars match but adding next expected char doesn't match`
              );
              console.log(`Expected: "${loremIpsum}"`);
              console.log(`Input with typos: "${inputWithTypos}"`);
              console.log(`Current input: "${currentInput}"`);
              console.log(`Next input (with expected char): "${nextInput}"`);
              console.log(`Next expected char: "${nextExpectedChar}"`);
              return false;
            }
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('should handle exact prefixes correctly', () => {
    // Base lorem ipsum text
    const loremIpsum = faker.lorem.sentence();

    fc.assert(
      fc.property(fc.constant(loremIpsum), expected => {
        // Test that exact prefixes always match
        for (
          let length = 3;
          length <= Math.min(10, expected.length);
          length++
        ) {
          const exactPrefix = expected.substring(0, length);
          const matches = fuzzyPartialMatch(exactPrefix, expected, maxDistance);

          if (!matches) {
            console.log(
              `Exact prefix failed: "${exactPrefix}" for "${expected}"`
            );
            return false;
          }
        }

        return true;
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

    console.log(`Testing: "${input1}" -> ${result1}`);
    console.log(`Testing: "${input2}" -> ${result2}`);

    // This should fail with current config
    expect(result1).toBe(true);
    expect(result2).toBe(true);
  });
});
