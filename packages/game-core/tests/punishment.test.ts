import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  BLOCKED_PUNISHMENT_LEVEL,
  canEscalate,
  canForgive,
  demandFor,
  escalate,
  forgive,
  isBlocked,
  isDemandClamped,
  isPlayable,
  isPunishmentLevel,
  MAX_PUNISHMENT_LEVEL,
  resetIfUnpunished,
  statusFor,
  type PlayablePunishmentLevel,
  type PunishmentLevel,
} from '../src/index.js';

const anyLevel = fc.constantFrom<PunishmentLevel>(0, 1, 2, 3);
const playableLevel = fc.constantFrom<PlayablePunishmentLevel>(0, 1, 2);

describe('punishment levels', () => {
  it('recognises the valid range and nothing else', () => {
    expect([0, 1, 2, 3].every(isPunishmentLevel)).toBe(true);
    expect([-1, 4, 1.5, Number.NaN, Infinity].some(isPunishmentLevel)).toBe(false);
  });

  it('treats level 3 and GAME_BLOCKED as the same fact', () => {
    // A CHECK constraint enforces the same equivalence in the database.
    for (const level of [0, 1, 2, 3] as PunishmentLevel[]) {
      expect(statusFor(level)).toBe(isBlocked(level) ? 'GAME_BLOCKED' : 'ACTIVE');
      expect(isPlayable(level)).toBe(!isBlocked(level));
    }
  });
});

describe('answer load', () => {
  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
  ] as [PlayablePunishmentLevel, number][])('level %i answers %i texts', (level, expected) => {
    expect(demandFor(level, 8)).toBe(expected);
  });

  it('clamps to the number of texts in play', () => {
    // Two players, one punished to level 2: they owe three answers but only two texts exist,
    // and nobody may receive the same text twice (D2). Without the clamp there is no solution.
    expect(demandFor(2, 2)).toBe(2);
    expect(demandFor(1, 2)).toBe(2);
    expect(demandFor(2, 3)).toBe(3);
  });

  it('reports when the clamp bit, so the lobby can say why', () => {
    expect(isDemandClamped(2, 2)).toBe(true);
    expect(isDemandClamped(2, 8)).toBe(false);
    expect(isDemandClamped(0, 8)).toBe(false);
  });

  it('never demands more texts than exist', () => {
    fc.assert(
      fc.property(playableLevel, fc.integer({ min: 0, max: 40 }), (level, textCount) => {
        expect(demandFor(level, textCount)).toBeLessThanOrEqual(textCount);
      }),
    );
  });

  it('always demands at least one text when any text exists', () => {
    fc.assert(
      fc.property(playableLevel, fc.integer({ min: 1, max: 40 }), (level, textCount) => {
        expect(demandFor(level, textCount)).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it('never decreases as punishment increases', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 40 }), (textCount) => {
        expect(demandFor(0, textCount)).toBeLessThanOrEqual(demandFor(1, textCount));
        expect(demandFor(1, textCount)).toBeLessThanOrEqual(demandFor(2, textCount));
      }),
    );
  });
});

describe('the escalation cycle', () => {
  it('climbs 0 → 1 → 2 → 3 and stops', () => {
    expect(escalate(0)).toBe(1);
    expect(escalate(1)).toBe(2);
    expect(escalate(2)).toBe(3);
    // There is nothing worse than blocked; punishing again must not overflow the range.
    expect(escalate(3)).toBe(3);
  });

  it('blocks the player exactly at the third consecutive punishment', () => {
    let level: PunishmentLevel = 0;

    expect(isBlocked(level)).toBe(false);
    level = escalate(level);
    expect(isBlocked(level)).toBe(false);
    level = escalate(level);
    expect(isBlocked(level)).toBe(false);
    level = escalate(level);
    expect(isBlocked(level)).toBe(true);
    expect(statusFor(level)).toBe('GAME_BLOCKED');
  });

  it('says when there is nothing left to escalate', () => {
    expect(canEscalate(2)).toBe(true);
    expect(canEscalate(3)).toBe(false);
  });

  it('forgives all the way to zero, not by one', () => {
    // A host who forgives is not reducing a sentence, they are clearing it.
    expect(forgive()).toBe(0);
    expect(canForgive(0)).toBe(false);
    expect(canForgive(1)).toBe(true);
    expect(canForgive(3)).toBe(true);
  });

  it('completes the full 0 → 3 → forgive → 0 cycle', () => {
    const blocked = escalate(escalate(escalate(0)));

    expect(blocked).toBe(BLOCKED_PUNISHMENT_LEVEL);
    expect(statusFor(blocked)).toBe('GAME_BLOCKED');

    const forgiven = forgive();

    expect(forgiven).toBe(0);
    expect(statusFor(forgiven)).toBe('ACTIVE');
    expect(demandFor(0, 8)).toBe(1);
  });

  it('never leaves the valid range, however many punishments land', () => {
    fc.assert(
      fc.property(anyLevel, fc.integer({ min: 0, max: 50 }), (start, punishments) => {
        let level = start;
        for (let index = 0; index < punishments; index += 1) level = escalate(level);

        expect(isPunishmentLevel(level)).toBe(true);
        expect(level).toBeLessThanOrEqual(MAX_PUNISHMENT_LEVEL);
      }),
    );
  });
});

describe('completing a game', () => {
  it('resets a player who was not punished for that game', () => {
    expect(resetIfUnpunished(2, false)).toBe(0);
    expect(resetIfUnpunished(1, false)).toBe(0);
    expect(resetIfUnpunished(0, false)).toBe(0);
  });

  it('keeps the level of a player who was punished for that game', () => {
    // Otherwise a punishment would evaporate the moment it took effect, and "consecutive" would
    // mean nothing (D5).
    expect(resetIfUnpunished(1, true)).toBe(1);
    expect(resetIfUnpunished(2, true)).toBe(2);
  });

  it('lands back at zero after any punish-then-clean-game sequence', () => {
    fc.assert(
      fc.property(anyLevel, fc.integer({ min: 0, max: 10 }), (start, punishments) => {
        let level = start;
        for (let index = 0; index < punishments; index += 1) level = escalate(level);

        // One game played without being punished wipes the slate, whatever came before.
        expect(resetIfUnpunished(level, false)).toBe(0);
      }),
    );
  });

  it('reaches blocked only through three consecutive punished games', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }), (punishedFlags) => {
        let level: PunishmentLevel = 0;

        for (const punished of punishedFlags) {
          if (punished) level = escalate(level);
          level = resetIfUnpunished(level, punished);
        }

        // Blocked implies the last three games were all punished ones.
        if (isBlocked(level)) {
          expect(punishedFlags.slice(-3)).toEqual([true, true, true]);
        }
      }),
    );
  });

  it('is idempotent for an unpunished player', () => {
    fc.assert(
      fc.property(anyLevel, (level) => {
        const once = resetIfUnpunished(level, false);
        expect(resetIfUnpunished(once, false)).toBe(once);
      }),
    );
  });
});
