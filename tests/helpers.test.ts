import fc from 'fast-check';
import { describe, it } from 'vitest';
import { fromNulls, mapNulls } from '../src/components/helpers';

describe('helpers', () => {
  describe('fromNulls', () => {
    it('should not contain nulls in result', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(fc.string(), fc.constant(null))),
          array => {
            const result = fromNulls(array);
            return result.every(x => x !== null);
          }
        )
      );
    });

    it('should never increase length', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(fc.string(), fc.constant(null))),
          array => {
            const result = fromNulls(array);
            return result.length <= array.length;
          }
        )
      );
    });

    it('should be idempotent', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(fc.string(), fc.constant(null))),
          array => {
            const result1 = fromNulls(array);
            const result2 = fromNulls(result1);
            return JSON.stringify(result1) === JSON.stringify(result2);
          }
        )
      );
    });

    it('should return same list when no nulls in input', () => {
      fc.assert(
        fc.property(fc.array(fc.string()), array => {
          const result = fromNulls(array);
          return JSON.stringify(result) === JSON.stringify(array);
        })
      );
    });
  });

  describe('mapNulls', () => {
    it('should not contain nulls in result', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string()),
          fc.func(fc.oneof(fc.string(), fc.constant(null))),
          (array, fn) => {
            const result = mapNulls(fn, array);
            return result.every(x => x !== null);
          }
        )
      );
    });

    it('should never increase length', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string()),
          fc.func(fc.oneof(fc.string(), fc.constant(null))),
          (array, fn) => {
            const result = mapNulls(fn, array);
            return result.length <= array.length;
          }
        )
      );
    });

    it('should return same list when function never returns null', () => {
      fc.assert(
        fc.property(fc.array(fc.string()), fc.string(), (array, suffix) => {
          const fn = (x: string) => x + suffix;
          const result = mapNulls(fn, array);
          const expected = array.map(fn);
          return JSON.stringify(result) === JSON.stringify(expected);
        })
      );
    });

    it('should return empty array when function always returns null', () => {
      fc.assert(
        fc.property(fc.array(fc.string()), array => {
          const result = mapNulls(() => null, array);
          return result.length === 0;
        })
      );
    });
  });

  describe('combined invariants', () => {
    it('mapNulls with identity should equal fromNulls', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(fc.string(), fc.constant(null))),
          array => {
            const mapNullsResult = mapNulls(x => x, array);
            const fromNullsResult = fromNulls(array);
            return (
              JSON.stringify(mapNullsResult) === JSON.stringify(fromNullsResult)
            );
          }
        )
      );
    });
  });
});
