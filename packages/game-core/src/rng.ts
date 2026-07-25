/**
 * A seeded, deterministic pseudo-random number generator.
 *
 * Every random decision in a game — which texts go to whom, what order the timeline reads in —
 * comes from here, seeded by a value stored on the session. That is what lets a distribution be
 * replayed months later from an eight-byte seed instead of by retaining the game itself, which
 * matters because the game is deleted (D11).
 *
 * `Math.random()` would make all of that impossible, which is why a lint rule forbids it in this
 * package. This is xoshiro128**: small, fast, and far better distributed than the
 * `sin(seed)` one-liners that circulate for this purpose.
 */

export interface Rng {
  /** Uniform in [0, 2³²). */
  nextUint32(): number;
  /** Uniform in [0, 1). */
  nextFloat(): number;
  /** Uniform integer in [0, maxExclusive). Unbiased. */
  nextInt(maxExclusive: number): number;
  /** A new array, shuffled. The input is never mutated. */
  shuffle<T>(items: readonly T[]): T[];
}

const rotateLeft = (value: number, bits: number): number =>
  ((value << bits) | (value >>> (32 - bits))) >>> 0;

/**
 * Draw a uniform integer in [0, maxExclusive) from a source of 32-bit words.
 *
 * Taking `word % max` skews toward low values whenever `max` does not divide 2³² evenly — with
 * three players that is a visible bias in who answers whose text, not a theoretical one. So words
 * landing in the ragged top slice are discarded and redrawn.
 *
 * Exported separately, and taking its source as a parameter, so the rejection branch can be
 * exercised directly: through the real generator it fires with probability under 2⁻³⁰, which
 * means no test would ever reach it.
 */
export function unbiasedBelow(maxExclusive: number, nextWord: () => number): number {
  if (maxExclusive <= 1) return 0;

  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;

  let value = nextWord();
  while (value >= limit) value = nextWord();

  return value % maxExclusive;
}

/**
 * splitmix32, used only to expand a single seed into four well-mixed words.
 *
 * Seeding xoshiro's state directly from the seed leaves it correlated for the first few outputs —
 * so a game seeded 1 and a game seeded 2 would start out suspiciously alike.
 */
function createStateFromSeed(seed: number): [number, number, number, number] {
  let value = seed >>> 0;

  const nextWord = (): number => {
    value = (value + 0x9e3779b9) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
    return (mixed ^ (mixed >>> 15)) >>> 0;
  };

  return [nextWord(), nextWord(), nextWord(), nextWord()];
}

/** Seeds arrive from the database as bigint; fold to the 32 bits the generator uses. */
const toSeedNumber = (seed: number | bigint): number =>
  typeof seed === 'bigint' ? Number(BigInt.asUintN(32, seed)) : Math.trunc(seed) >>> 0;

export function seededRng(seed: number | bigint): Rng {
  const state = createStateFromSeed(toSeedNumber(seed));

  const nextUint32 = (): number => {
    const result = Math.imul(rotateLeft(Math.imul(state[1], 5) >>> 0, 7), 9) >>> 0;
    const shifted = (state[1] << 9) >>> 0;

    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= shifted;
    state[3] = rotateLeft(state[3], 11);

    return result;
  };

  const nextInt = (maxExclusive: number): number => unbiasedBelow(maxExclusive, nextUint32);

  return {
    nextUint32,
    nextFloat: () => nextUint32() / 0x100000000,
    nextInt,

    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];

      // Fisher–Yates, back to front.
      for (let index = result.length - 1; index > 0; index -= 1) {
        const target = nextInt(index + 1);
        const swap = result[index] as T;
        result[index] = result[target] as T;
        result[target] = swap;
      }

      return result;
    },
  };
}
