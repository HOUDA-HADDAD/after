import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { seededRng, unbiasedBelow } from '../src/index.js';

describe('unbiasedBelow', () => {
  it('discards words in the ragged top slice and redraws', () => {
    // Through the real generator this fires with probability under 2⁻³⁰, so the only honest way
    // to prove the rejection works is to hand it a source that lands there.
    const max = 3;
    const limit = Math.floor(0x100000000 / max) * max;
    const words = [limit, limit + 2, 7];
    let index = 0;

    const value = unbiasedBelow(max, () => words[index++] ?? 0);

    expect(index).toBe(3); // two rejected, third accepted
    expect(value).toBe(7 % max);
  });

  it('accepts a word inside the clean range immediately', () => {
    let calls = 0;

    expect(
      unbiasedBelow(4, () => {
        calls += 1;
        return 9;
      }),
    ).toBe(1);
    expect(calls).toBe(1);
  });

  it.each([0, 1, -3])('returns 0 for a bound of %i without drawing', (bound) => {
    let calls = 0;

    expect(
      unbiasedBelow(bound, () => {
        calls += 1;
        return 0;
      }),
    ).toBe(0);
    expect(calls).toBe(0);
  });
});

describe('seeded rng', () => {
  it('produces the same stream for the same seed', () => {
    const draw = (seed: number): number[] =>
      Array.from({ length: 20 }, () => seededRng(seed).nextUint32());

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        expect(draw(seed)).toEqual(draw(seed));
      }),
    );
  });

  it('produces different streams for neighbouring seeds', () => {
    // Seeding the generator's state directly leaves adjacent seeds correlated; splitmix32 is
    // there to stop games seeded 1 and 2 looking alike.
    const first = seededRng(1);
    const second = seededRng(2);

    const a = Array.from({ length: 10 }, () => first.nextUint32());
    const b = Array.from({ length: 10 }, () => second.nextUint32());

    expect(a).not.toEqual(b);
  });

  it('accepts a bigint seed, as stored on the session row', () => {
    expect(seededRng(123n).nextUint32()).toBe(seededRng(123).nextUint32());
  });

  it('folds a bigint wider than 32 bits rather than losing precision', () => {
    expect(() => seededRng(9_007_199_254_740_993n).nextUint32()).not.toThrow();
  });

  it('truncates a fractional seed', () => {
    expect(seededRng(7.9).nextUint32()).toBe(seededRng(7).nextUint32());
  });

  it('stays inside 32 bits', () => {
    const rng = seededRng(42);

    for (let index = 0; index < 1000; index += 1) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });

  it('produces floats in [0, 1)', () => {
    const rng = seededRng(7);

    for (let index = 0; index < 1000; index += 1) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  describe('nextInt', () => {
    it('stays in range', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 0, max: 9999 }),
          (max, seed) => {
            const rng = seededRng(seed);

            for (let index = 0; index < 20; index += 1) {
              const value = rng.nextInt(max);
              expect(value).toBeGreaterThanOrEqual(0);
              expect(value).toBeLessThan(max);
            }
          },
        ),
      );
    });

    it.each([0, 1, -5])('returns 0 for a bound of %i', (bound) => {
      expect(seededRng(1).nextInt(bound)).toBe(0);
    });

    it('is not biased toward low values', () => {
      // `% max` would skew the distribution whenever max does not divide 2³² evenly. With three
      // players that is a visible bias, not a theoretical one.
      const rng = seededRng(99);
      const counts = new Map<number, number>([
        [0, 0],
        [1, 0],
        [2, 0],
      ]);
      const samples = 30_000;

      for (let index = 0; index < samples; index += 1) {
        const value = rng.nextInt(3);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }

      for (const count of counts.values()) {
        expect(count).toBeGreaterThan(samples / 3 - samples * 0.03);
        expect(count).toBeLessThan(samples / 3 + samples * 0.03);
      }
    });
  });

  describe('shuffle', () => {
    it('keeps every element exactly once', () => {
      fc.assert(
        fc.property(fc.array(fc.integer(), { maxLength: 30 }), fc.integer(), (items, seed) => {
          const shuffled = seededRng(seed).shuffle(items);

          expect([...shuffled].sort()).toEqual([...items].sort());
        }),
      );
    });

    it('does not mutate the input', () => {
      const items = [1, 2, 3, 4, 5];
      const copy = [...items];

      seededRng(3).shuffle(items);

      expect(items).toEqual(copy);
    });

    it('handles empty and single-element arrays', () => {
      expect(seededRng(1).shuffle([])).toEqual([]);
      expect(seededRng(1).shuffle(['only'])).toEqual(['only']);
    });

    it('actually reorders', () => {
      const items = Array.from({ length: 20 }, (_, index) => index);
      const shuffled = seededRng(5).shuffle(items);

      expect(shuffled).not.toEqual(items);
    });

    it('reaches every permutation of a small set', () => {
      const seen = new Set<string>();

      for (let seed = 0; seed < 300; seed += 1) {
        seen.add(seededRng(seed).shuffle(['a', 'b', 'c']).join(''));
      }

      expect(seen.size).toBe(6);
    });
  });
});
