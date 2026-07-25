import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  allowedActions,
  canAdvanceFromAnswering,
  canAdvanceFromWriting,
  canStart,
  canTransition,
  type GameAction,
  isActionAllowed,
  isLive,
  isTerminal,
  MIN_PLAYERS_PER_SESSION,
  nextPhase,
  SESSION_PHASES,
  transitionsFrom,
  type SessionPhase,
} from '../src/index.js';

const anyPhase = fc.constantFrom<SessionPhase>(...SESSION_PHASES);

describe('the phase machine', () => {
  it('walks the happy path end to end', () => {
    const path: SessionPhase[] = ['LOBBY', 'WRITING', 'ANSWERING', 'REVIEW', 'REVEAL', 'COMPLETED'];

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransition(path[index]!, path[index + 1]!)).toBe(true);
      expect(nextPhase(path[index]!)).toBe(path[index + 1]);
    }
  });

  it('never moves once terminal', () => {
    for (const phase of ['COMPLETED', 'CANCELLED', 'ABANDONED'] as const) {
      expect(isTerminal(phase)).toBe(true);
      expect(isLive(phase)).toBe(false);
      expect(transitionsFrom(phase)).toEqual([]);
      expect(nextPhase(phase)).toBeNull();
    }
  });

  it('rejects every transition that is not in the table', () => {
    // Exhaustive over all 64 ordered pairs: skipping a phase, going backwards, or standing still
    // are all rejected because they are simply absent from the table.
    for (const from of SESSION_PHASES) {
      for (const to of SESSION_PHASES) {
        expect(canTransition(from, to)).toBe(transitionsFrom(from).includes(to));
      }
    }
  });

  it.each([
    ['skipping the writing phase', 'LOBBY', 'ANSWERING'],
    ['going backwards', 'ANSWERING', 'WRITING'],
    ['standing still', 'WRITING', 'WRITING'],
    ['jumping to the end', 'LOBBY', 'COMPLETED'],
    ['resurrecting a cancelled game', 'CANCELLED', 'LOBBY'],
    ['abandoning after the vote opened', 'REVEAL', 'ABANDONED'],
  ] as [string, SessionPhase, SessionPhase][])('rejects %s', (_label, from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('can abandon from every live phase except the vote', () => {
    // A game whose players walked away must not hold its group's only slot forever (D12) — but
    // by REVEAL the game has been played, so it completes rather than evaporating.
    for (const phase of ['LOBBY', 'WRITING', 'ANSWERING', 'REVIEW'] as const) {
      expect(canTransition(phase, 'ABANDONED')).toBe(true);
    }

    expect(canTransition('REVEAL', 'ABANDONED')).toBe(false);
  });

  it('can only be cancelled before it starts', () => {
    expect(canTransition('LOBBY', 'CANCELLED')).toBe(true);

    for (const phase of ['WRITING', 'ANSWERING', 'REVIEW', 'REVEAL'] as const) {
      expect(canTransition(phase, 'CANCELLED')).toBe(false);
    }
  });

  it('never reaches an unknown phase, however it is walked', () => {
    fc.assert(
      fc.property(
        anyPhase,
        fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 20 }),
        (start, steps) => {
          let phase = start;

          for (const step of steps) {
            const options = transitionsFrom(phase);
            if (options.length === 0) break;
            phase = options[step % options.length]!;
          }

          expect(SESSION_PHASES).toContain(phase);
        },
      ),
    );
  });

  it('always terminates when walked forward', () => {
    fc.assert(
      fc.property(anyPhase, (start) => {
        let phase = start;
        let steps = 0;

        while (nextPhase(phase) !== null) {
          phase = nextPhase(phase)!;
          steps += 1;
          expect(steps).toBeLessThanOrEqual(SESSION_PHASES.length);
        }

        expect(isTerminal(phase)).toBe(true);
      }),
    );
  });
});

describe('what each role may do', () => {
  it('gives hosts everything players have, and more', () => {
    for (const phase of SESSION_PHASES) {
      const players = allowedActions(phase, 'PLAYER');
      const hosts = allowedActions(phase, 'HOST');

      for (const action of players) expect(hosts).toContain(action);
    }
  });

  it('allows nothing at all once the game is cancelled or abandoned', () => {
    for (const phase of ['CANCELLED', 'ABANDONED'] as const) {
      expect(allowedActions(phase, 'HOST')).toEqual([]);
      expect(allowedActions(phase, 'PLAYER')).toEqual([]);
    }
  });

  it.each([
    ['submitText', 'WRITING'],
    ['submitAnswer', 'ANSWERING'],
    ['comment', 'REVIEW'],
    ['guess', 'REVIEW'],
    ['castRevealVote', 'REVEAL'],
  ] as [GameAction, SessionPhase][])(
    '%s belongs to %s and nowhere else',
    (action, expectedPhase) => {
      for (const phase of SESSION_PHASES) {
        expect(isActionAllowed(phase, 'PLAYER', action)).toBe(phase === expectedPhase);
      }
    },
  );

  it('keeps host-only actions away from players', () => {
    for (const action of [
      'start',
      'cancel',
      'punish',
      'forgive',
      'endGame',
      'forceAdvance',
    ] as const) {
      for (const phase of SESSION_PHASES) {
        expect(isActionAllowed(phase, 'PLAYER', action)).toBe(false);
      }
    }
  });

  it('lets a host force the game forward only while it is being played', () => {
    // Without this, one absent player freezes a session forever (D14).
    for (const phase of SESSION_PHASES) {
      expect(isActionAllowed(phase, 'HOST', 'forceAdvance')).toBe(
        phase === 'WRITING' || phase === 'ANSWERING',
      );
    }
  });

  it('lets everyone read the timeline once it exists', () => {
    for (const phase of ['REVIEW', 'REVEAL', 'COMPLETED'] as const) {
      expect(isActionAllowed(phase, 'PLAYER', 'readTimeline')).toBe(true);
    }

    expect(isActionAllowed('WRITING', 'PLAYER', 'readTimeline')).toBe(false);
  });
});

describe('transition guards', () => {
  it('needs two players to start', () => {
    expect(canStart({ eligiblePlayerCount: MIN_PLAYERS_PER_SESSION })).toBe(true);
    expect(canStart({ eligiblePlayerCount: 1 })).toBe(false);
    expect(canStart({ eligiblePlayerCount: 0 })).toBe(false);
  });

  describe('leaving the writing phase', () => {
    it('waits for everyone by default', () => {
      expect(canAdvanceFromWriting({ submitted: 7, required: 8, forced: false })).toBe(false);
      expect(canAdvanceFromWriting({ submitted: 8, required: 8, forced: false })).toBe(true);
    });

    it('lets a host skip ahead, but never below two texts', () => {
      // A game with one text has nothing to distribute.
      expect(canAdvanceFromWriting({ submitted: 1, required: 8, forced: true })).toBe(false);
      expect(canAdvanceFromWriting({ submitted: 2, required: 8, forced: true })).toBe(true);
    });

    it('refuses when nothing is required, which would mean an empty game', () => {
      expect(canAdvanceFromWriting({ submitted: 0, required: 0, forced: false })).toBe(false);
    });
  });

  describe('leaving the answering phase', () => {
    it('waits for every assignment by default', () => {
      expect(canAdvanceFromAnswering({ submitted: 9, required: 10, forced: false })).toBe(false);
      expect(canAdvanceFromAnswering({ submitted: 10, required: 10, forced: false })).toBe(true);
    });

    it('lets a host skip at any count', () => {
      // Unanswered assignments show as "no answer"; a thin timeline is dull, not broken.
      expect(canAdvanceFromAnswering({ submitted: 0, required: 10, forced: true })).toBe(true);
    });

    it('refuses when nothing is required', () => {
      expect(canAdvanceFromAnswering({ submitted: 0, required: 0, forced: false })).toBe(false);
    });
  });
});
