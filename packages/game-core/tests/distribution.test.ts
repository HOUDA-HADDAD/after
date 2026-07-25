import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  demandFor,
  distribute,
  InfeasibleDistributionError,
  selfAssignments,
  usageByText,
  type Assignment,
  type DistributableText,
  type DistributionInput,
  type DistributionPlayer,
  type PlayablePunishmentLevel,
} from '../src/index.js';

/* ---- generators ------------------------------------------------------------------------- */

/** A game of `n` players, each having written one text, with the given punishment levels. */
function makeGame(levels: readonly PlayablePunishmentLevel[], seed: number): DistributionInput {
  const texts: DistributableText[] = levels.map((_, index) => ({
    id: `text-${String(index)}`,
    authorPlayerId: `player-${String(index)}`,
  }));

  const players: DistributionPlayer[] = levels.map((level, index) => ({
    id: `player-${String(index)}`,
    demand: demandFor(level, texts.length),
  }));

  return { texts, players, seed };
}

/**
 * The fewest self-assignments this game can possibly have.
 *
 * A player may hold each text at most once (I2), so someone owed `d` answers out of `N` texts,
 * one of which they wrote, can be spared their own only while `d ≤ N - 1`. Beyond that the deal
 * is forced. Summing that over the table gives the floor — and "only when unavoidable" (I5) means
 * the algorithm hits it exactly, not merely comes close.
 */
function unavoidableSelfAssignments(game: DistributionInput): number {
  return game.players.reduce((total, player) => {
    const wrote = game.texts.filter((text) => text.authorPlayerId === player.id).length;

    return total + Math.max(0, player.demand - (game.texts.length - wrote));
  }, 0);
}

const gameArbitrary = fc
  .integer({ min: 2, max: 40 })
  .chain((playerCount) =>
    fc.record({
      levels: fc.array(fc.constantFrom<PlayablePunishmentLevel>(0, 1, 2), {
        minLength: playerCount,
        maxLength: playerCount,
      }),
      seed: fc.integer({ min: 0, max: 2 ** 31 }),
    }),
  )
  .map(({ levels, seed }) => makeGame(levels, seed));

/* ---- invariant helpers ------------------------------------------------------------------ */

const receivedBy = (assignments: readonly Assignment[], playerId: string): string[] =>
  assignments.filter((a) => a.receiverPlayerId === playerId).map((a) => a.textId);

describe('distribution invariants', () => {
  it('I1 — every player receives exactly their demand', () => {
    fc.assert(
      fc.property(gameArbitrary, (game) => {
        const assignments = distribute(game);

        for (const player of game.players) {
          expect(receivedBy(assignments, player.id)).toHaveLength(player.demand);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('I2 — no player receives the same text twice', () => {
    // Since each author writes exactly one text, this is identical to "never two texts by the
    // same author to one receiver" (D2) — the rule the database also enforces with a unique index.
    fc.assert(
      fc.property(gameArbitrary, (game) => {
        const assignments = distribute(game);

        for (const player of game.players) {
          const received = receivedBy(assignments, player.id);
          expect(new Set(received).size).toBe(received.length);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('I3 — every text is assigned at least once', () => {
    fc.assert(
      fc.property(gameArbitrary, (game) => {
        const usage = usageByText(distribute(game));

        // Nobody's text should go unanswered — that is a player who wrote something and got
        // nothing back.
        for (const text of game.texts) {
          expect(usage.get(text.id) ?? 0).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('I4 — usage is balanced within one', () => {
    fc.assert(
      fc.property(gameArbitrary, (game) => {
        const totalSlots = game.players.reduce((sum, player) => sum + player.demand, 0);
        const base = Math.floor(totalSlots / game.texts.length);
        const usage = usageByText(distribute(game));

        for (const text of game.texts) {
          const used = usage.get(text.id) ?? 0;
          expect(used).toBeGreaterThanOrEqual(base);
          expect(used).toBeLessThanOrEqual(base + 1);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('I5 — no self-assignment whenever every demand leaves an alternative', () => {
    fc.assert(
      fc.property(
        gameArbitrary.filter(
          (game) =>
            game.texts.length >= 3 && game.players.every((p) => p.demand <= game.texts.length - 1),
        ),
        (game) => {
          // With at least three texts and nobody owed all of them, a self-free arrangement
          // always exists — and augmenting paths find it whenever it does.
          expect(selfAssignments(game.texts, distribute(game))).toEqual([]);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('I5 — self-assignment never exceeds what the demands force', () => {
    fc.assert(
      fc.property(gameArbitrary, (game) => {
        // The stronger statement, and the one D4 actually makes: not "none in the easy region"
        // but "none that a legal swap could have removed", everywhere.
        expect(selfAssignments(game.texts, distribute(game))).toHaveLength(
          unavoidableSelfAssignments(game),
        );
      }),
      { numRuns: 1_000 },
    );
  });

  it('spares everyone else when one player is owed every text', () => {
    // The shape that exposed the old fallback: three texts, demands 1, 3, 1. The middle player
    // must receive their own — there is nothing else left to give them — but the other two have
    // two alternatives each. Dropping the rule for the whole game because one player needed it
    // handed all three a text they wrote, roughly two games in three.
    for (let seed = 0; seed < 400; seed += 1) {
      const game = makeGame([0, 2, 0], seed);
      const self = selfAssignments(game.texts, distribute(game));

      expect(self).toHaveLength(1);
      expect(self[0]?.receiverPlayerId).toBe('player-1');
    }
  });

  it('produces exactly the total number of answer slots', () => {
    fc.assert(
      fc.property(gameArbitrary, (game) => {
        const totalSlots = game.players.reduce((sum, player) => sum + player.demand, 0);

        expect(distribute(game)).toHaveLength(totalSlots);
      }),
      { numRuns: 200 },
    );
  });
});

describe('all invariants together, at volume', () => {
  // Ten thousand full-range games take real time to generate and solve. It is the phase's exit
  // criterion, so it runs — with a timeout that reflects the work rather than masking it.
  it('holds across ten thousand generated games', { timeout: 180_000 }, () => {
    // The exit criterion for this phase. Checking every invariant in one pass costs a single
    // distribution per case, which is what makes this many runs affordable.
    fc.assert(
      fc.property(gameArbitrary, (game) => {
        const assignments = distribute(game);
        const usage = usageByText(assignments);
        const totalSlots = game.players.reduce((sum, player) => sum + player.demand, 0);
        const base = Math.floor(totalSlots / game.texts.length);

        for (const player of game.players) {
          const received = receivedBy(assignments, player.id);

          expect(received).toHaveLength(player.demand); // I1
          expect(new Set(received).size).toBe(received.length); // I2
        }

        for (const text of game.texts) {
          const used = usage.get(text.id) ?? 0;

          expect(used).toBeGreaterThanOrEqual(Math.max(base, 1)); // I3 + I4 lower bound
          expect(used).toBeLessThanOrEqual(base + 1); // I4 upper bound
        }

        // I5 — at the floor, in every shape, not only where the floor happens to be zero.
        expect(selfAssignments(game.texts, assignments)).toHaveLength(
          unavoidableSelfAssignments(game),
        );
      }),
      { numRuns: 10_000 },
    );
  });
});

describe('determinism', () => {
  it('the same seed always produces the same assignment', () => {
    fc.assert(
      fc.property(gameArbitrary, (game) => {
        // This is what lets a distribution be replayed from an eight-byte seed after the game
        // itself has been deleted.
        expect(distribute(game)).toEqual(distribute(game));
      }),
      { numRuns: 200 },
    );
  });

  it('different seeds usually produce different assignments', () => {
    const levels: PlayablePunishmentLevel[] = [0, 0, 0, 0, 0, 0];
    const serialise = (seed: number): string => JSON.stringify(distribute(makeGame(levels, seed)));

    const shapes = new Set(Array.from({ length: 40 }, (_, seed) => serialise(seed)));

    // A generator that ignored its seed would collapse to one shape; this catches that.
    expect(shapes.size).toBeGreaterThan(5);
  });
});

describe('small and awkward games', () => {
  it('handles the two-player minimum', () => {
    const game = makeGame([0, 0], 42);
    const assignments = distribute(game);

    expect(assignments).toHaveLength(2);
    // With two texts and one each, the only self-free solution is a straight swap.
    expect(selfAssignments(game.texts, assignments)).toEqual([]);
  });

  it('allows self-assignment when nothing else is possible', () => {
    // Two players, one punished to level 2: their demand clamps to 2 (D3), and only two texts
    // exist — so one of them is necessarily their own. The brief permits this (D4).
    const game = makeGame([2, 0], 7);

    expect(game.players[0]?.demand).toBe(2);
    expect(distribute(game)).toHaveLength(3);
  });

  it('gives a punished player more texts than everyone else', () => {
    const game = makeGame([2, 0, 0, 0, 0, 0, 0, 0], 99);
    const assignments = distribute(game);

    expect(receivedBy(assignments, 'player-0')).toHaveLength(3);
    expect(receivedBy(assignments, 'player-1')).toHaveLength(1);
    // Eight players, one at level 2: ten slots over eight texts (D1).
    expect(assignments).toHaveLength(10);
  });

  it('finds the self-free arrangement when only one capacity layout admits it', () => {
    // Pinned counterexample. Four texts, demands 3, 3, 1, 3: the three big receivers all need the
    // one text none of them wrote, so a self-free arrangement exists only if *that* text holds a
    // spare use. Allocating spare capacity up front and retrying failed roughly once in 256 here,
    // which was rare enough to pass ten thousand generated games and still be wrong.
    const texts: DistributableText[] = [0, 1, 2, 3].map((index) => ({
      id: `text-${String(index)}`,
      authorPlayerId: `player-${String(index)}`,
    }));

    const players: DistributionPlayer[] = [3, 3, 1, 3].map((demand, index) => ({
      id: `player-${String(index)}`,
      demand,
    }));

    // Every seed must find it now, not merely most of them.
    for (let seed = 0; seed < 300; seed += 1) {
      const assignments = distribute({ texts, players, seed });

      expect(assignments).toHaveLength(10);
      expect(selfAssignments(texts, assignments)).toEqual([]);
    }
  });

  it('copes with every player punished to the maximum playable level', () => {
    const game = makeGame([2, 2, 2, 2, 2], 3);
    const assignments = distribute(game);

    expect(assignments).toHaveLength(15);
    expect(selfAssignments(game.texts, assignments)).toEqual([]);
  });
});

describe('rejecting impossible input', () => {
  it('refuses when a player is owed more texts than exist', () => {
    // `demandFor` clamps precisely to prevent this, so reaching it means the caller skipped it.
    const input: DistributionInput = {
      texts: [{ id: 't1', authorPlayerId: 'p1' }],
      players: [{ id: 'p1', demand: 2 }],
      seed: 1,
    };

    expect(() => distribute(input)).toThrow(InfeasibleDistributionError);
    expect(() => distribute(input)).toThrow(/only 1 exist/);
  });

  it('refuses with no texts at all', () => {
    expect(() => distribute({ texts: [], players: [{ id: 'p1', demand: 1 }], seed: 1 })).toThrow(
      InfeasibleDistributionError,
    );
  });

  it.each([
    ['a fractional demand', 1.5],
    ['a negative demand', -1],
  ])('refuses %s', (_label, demand) => {
    expect(() =>
      distribute({
        texts: [{ id: 't1', authorPlayerId: 'p1' }],
        players: [{ id: 'p1', demand }],
        seed: 1,
      }),
    ).toThrow(InfeasibleDistributionError);
  });

  it('returns nothing when nobody is owed anything', () => {
    const assignments = distribute({
      texts: [{ id: 't1', authorPlayerId: 'p1' }],
      players: [{ id: 'p1', demand: 0 }],
      seed: 1,
    });

    expect(assignments).toEqual([]);
  });
});

describe('helpers', () => {
  it('counts usage per text', () => {
    const usage = usageByText([
      { textId: 'a', receiverPlayerId: 'p1' },
      { textId: 'a', receiverPlayerId: 'p2' },
      { textId: 'b', receiverPlayerId: 'p1' },
    ]);

    expect(usage.get('a')).toBe(2);
    expect(usage.get('b')).toBe(1);
    expect(usage.get('missing')).toBeUndefined();
  });

  it('spots self-assignments', () => {
    const texts: DistributableText[] = [{ id: 'a', authorPlayerId: 'p1' }];

    expect(
      selfAssignments(texts, [
        { textId: 'a', receiverPlayerId: 'p1' },
        { textId: 'a', receiverPlayerId: 'p2' },
      ]),
    ).toEqual([{ textId: 'a', receiverPlayerId: 'p1' }]);
  });
});
