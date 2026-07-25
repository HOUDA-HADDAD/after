import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeRevealOutcome,
  entitlementFor,
  projectTimeline,
  SESSION_PHASES,
  type ParticipantVote,
  type RevealParticipant,
  type SessionPhase,
  type TimelineInput,
} from '../src/index.js';

const participants = (count: number, left: number[] = []): RevealParticipant[] =>
  Array.from({ length: count }, (_, index) => ({
    playerId: `p${String(index)}`,
    hasLeft: left.includes(index),
  }));

const votes = (choices: ('YES' | 'NO' | null)[]): ParticipantVote[] =>
  choices.flatMap((choice, index) =>
    choice === null ? [] : [{ playerId: `p${String(index)}`, choice }],
  );

describe('the collective reveal decision', () => {
  it('reveals only when everyone says yes', () => {
    const outcome = computeRevealOutcome(participants(3), votes(['YES', 'YES', 'YES']));

    expect(outcome.revealed).toBe(true);
    expect(outcome.everyoneDecided).toBe(true);
  });

  it('one no keeps the timeline anonymous for everyone', () => {
    // Including for the people who voted yes. That is the whole point of collective reveal (D8):
    // a single refusal protects the whole table.
    const outcome = computeRevealOutcome(participants(3), votes(['YES', 'YES', 'NO']));

    expect(outcome.revealed).toBe(false);
    expect(outcome.everyoneDecided).toBe(true);
  });

  it('treats silence as refusal', () => {
    // Abstention must never authorise disclosure.
    const outcome = computeRevealOutcome(participants(3), votes(['YES', 'YES', null]));

    expect(outcome.revealed).toBe(false);
    expect(outcome.decided).toBe(2);
    expect(outcome.everyoneDecided).toBe(false);
  });

  it('ignores players who left before the vote', () => {
    // Otherwise one person walking away makes reveal permanently unreachable for the rest (D8).
    const outcome = computeRevealOutcome(participants(3, [2]), votes(['YES', 'YES', null]));

    expect(outcome.revealed).toBe(true);
    expect(outcome.total).toBe(2);
  });

  it('does not reveal when everyone has left', () => {
    expect(computeRevealOutcome(participants(2, [0, 1]), []).revealed).toBe(false);
  });

  it('never exposes the yes/no split', () => {
    // "5 of 8 voted yes" identifies the refuser in a small group, and exactly identifies them in
    // a game of two (D8a). The outcome carries a boolean and two counts, and nothing else.
    const outcome = computeRevealOutcome(participants(4), votes(['YES', 'NO', 'YES', 'NO']));

    expect(Object.keys(outcome).sort()).toEqual([
      'decided',
      'everyoneDecided',
      'revealed',
      'total',
    ]);
    expect(JSON.stringify(outcome)).not.toMatch(/yes|no/i);
  });

  it('reveals only on unanimity, whatever the vote mixture', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<'YES' | 'NO' | null>('YES', 'NO', null), {
          minLength: 1,
          maxLength: 10,
        }),
        (choices) => {
          const outcome = computeRevealOutcome(participants(choices.length), votes(choices));

          expect(outcome.revealed).toBe(choices.every((choice) => choice === 'YES'));
        },
      ),
    );
  });
});

describe('entitlement', () => {
  it('withholds names until voting is finished, even when unanimous so far', () => {
    // A refresh at the right moment must not leak names mid-vote.
    const unanimous = computeRevealOutcome(participants(2), votes(['YES', 'YES']));

    expect(entitlementFor('REVEAL', unanimous).authorsVisible).toBe(false);
    expect(entitlementFor('COMPLETED', unanimous).authorsVisible).toBe(true);
  });

  it('never shows names in a live phase', () => {
    const unanimous = computeRevealOutcome(participants(2), votes(['YES', 'YES']));

    for (const phase of ['LOBBY', 'WRITING', 'ANSWERING', 'REVIEW', 'REVEAL'] as SessionPhase[]) {
      expect(entitlementFor(phase, unanimous).authorsVisible).toBe(false);
    }
  });

  it('never shows names when the vote failed, in any phase', () => {
    const refused = computeRevealOutcome(participants(2), votes(['YES', 'NO']));

    for (const phase of SESSION_PHASES) {
      expect(entitlementFor(phase, refused).authorsVisible).toBe(false);
    }
  });
});

/* ---- timeline projection ----------------------------------------------------------------- */

const baseTimeline = (phase: SessionPhase, choices: ('YES' | 'NO')[]): TimelineInput => ({
  phase,
  outcome: computeRevealOutcome(participants(choices.length), votes(choices)),
  viewerPlayerId: 'p0',
  players: [
    { playerId: 'p0', username: 'sarah' },
    { playerId: 'p1', username: 'ahmed' },
  ],
  texts: [
    { id: 't1', body: 'Funniest memory?', authorPlayerId: 'p1', displayOrder: 1 },
    { id: 't0', body: 'Craziest thing?', authorPlayerId: 'p0', displayOrder: 0 },
  ],
  answers: [
    { id: 'a1', textId: 't1', body: 'I once…', authorPlayerId: 'p0', skipped: false },
    { id: 'a0', textId: 't0', body: null, authorPlayerId: 'p1', skipped: true },
  ],
  comments: [
    {
      id: 'c1',
      answerId: 'a1',
      body: 'That is hilarious',
      authorPlayerId: 'p1',
      isAnonymous: true,
      createdAt: '2026-07-25T10:00:00.000Z',
    },
    {
      id: 'c2',
      answerId: 'a1',
      body: 'I think I know who wrote this',
      authorPlayerId: 'p1',
      isAnonymous: false,
      createdAt: '2026-07-25T10:01:00.000Z',
    },
  ],
  guesses: [{ textId: 't1', guesserPlayerId: 'p0', guessedPlayerId: 'p1' }],
});

describe('timeline projection', () => {
  it('hides every author while the game is live', () => {
    const view = projectTimeline(baseTimeline('REVIEW', ['YES', 'YES']));

    expect(view.authorsVisible).toBe(false);
    for (const text of view.texts) {
      expect(text.author).toBeNull();
      for (const answer of text.answers) expect(answer.author).toBeNull();
    }
  });

  it('shows authors once the group agreed and the game finished', () => {
    const view = projectTimeline(baseTimeline('COMPLETED', ['YES', 'YES']));

    expect(view.authorsVisible).toBe(true);
    expect(view.texts.find((text) => text.id === 't1')?.author?.username).toBe('ahmed');
    expect(view.texts.find((text) => text.id === 't1')?.answers[0]?.author?.username).toBe('sarah');
  });

  it('hides authors when one person refused, even at the end', () => {
    const view = projectTimeline(baseTimeline('COMPLETED', ['YES', 'NO']));

    expect(view.authorsVisible).toBe(false);
    expect(view.texts.every((text) => text.author === null)).toBe(true);
  });

  it('keeps anonymous comments anonymous after the reveal', () => {
    // The promise is made when the person presses Post; the group's later vote is not theirs to
    // override (D17).
    const view = projectTimeline(baseTimeline('COMPLETED', ['YES', 'YES']));
    const comments = view.texts.find((text) => text.id === 't1')?.answers[0]?.comments ?? [];

    expect(comments.find((comment) => comment.id === 'c1')?.author).toBeNull();
    expect(comments.find((comment) => comment.id === 'c2')?.author?.username).toBe('ahmed');
  });

  it('shows named comments even while the game is anonymous', () => {
    // Someone who signed their comment chose to be seen; that is unrelated to authorship.
    const view = projectTimeline(baseTimeline('REVIEW', ['YES', 'YES']));
    const comments = view.texts.find((text) => text.id === 't1')?.answers[0]?.comments ?? [];

    expect(comments.find((comment) => comment.id === 'c2')?.author?.username).toBe('ahmed');
    expect(comments.find((comment) => comment.id === 'c1')?.author).toBeNull();
  });

  it('orders by display order, not by submission order', () => {
    // Submission order identifies the fastest typist.
    const view = projectTimeline(baseTimeline('REVIEW', ['YES', 'YES']));

    expect(view.texts.map((text) => text.id)).toEqual(['t0', 't1']);
  });

  it('shows a viewer their own guess but not whether it was right', () => {
    const view = projectTimeline(baseTimeline('REVIEW', ['YES', 'YES']));
    const text = view.texts.find((entry) => entry.id === 't1');

    // They already know what they picked; telling them it was correct would disclose the author
    // just as surely as naming them (D9).
    expect(text?.yourGuess?.username).toBe('ahmed');
    expect(text?.yourGuessCorrect).toBeNull();
  });

  it('scores guesses only once authors are revealed', () => {
    const hidden = projectTimeline(baseTimeline('COMPLETED', ['YES', 'NO']));
    const shown = projectTimeline(baseTimeline('COMPLETED', ['YES', 'YES']));

    expect(hidden.guessScores).toBeNull();
    expect(hidden.texts.every((text) => text.yourGuessCorrect === null)).toBe(true);

    expect(shown.texts.find((text) => text.id === 't1')?.yourGuessCorrect).toBe(true);
    expect(shown.guessScores).toEqual([
      { player: { playerId: 'p0', username: 'sarah' }, correct: 1, total: 1 },
    ]);
  });

  it('never leaks an identifier in any live phase, for any vote mixture', () => {
    // The assertion is on the serialized payload, because a leak is defined by what crosses the
    // wire — not by what a component happens to render.
    fc.assert(
      fc.property(
        fc.constantFrom<SessionPhase>('LOBBY', 'WRITING', 'ANSWERING', 'REVIEW', 'REVEAL'),
        fc.array(fc.constantFrom<'YES' | 'NO'>('YES', 'NO'), { minLength: 2, maxLength: 2 }),
        (phase, choices) => {
          const view = projectTimeline(baseTimeline(phase, choices));

          for (const text of view.texts) {
            expect(text.author).toBeNull();
            expect(text.yourGuessCorrect).toBeNull();
            for (const answer of text.answers) expect(answer.author).toBeNull();
          }

          expect(view.guessScores).toBeNull();
        },
      ),
    );
  });

  it('carries a skipped answer through as an absence rather than dropping it', () => {
    const view = projectTimeline(baseTimeline('REVIEW', ['YES', 'YES']));
    const answer = view.texts.find((text) => text.id === 't0')?.answers[0];

    expect(answer?.skipped).toBe(true);
    expect(answer?.body).toBeNull();
  });

  it('shows both answers when a text was handed to two players', () => {
    // The direct consequence of the punishment mechanic (D1), and one of the better moments in
    // the game: the same question answered twice, by two anonymous people.
    const input = baseTimeline('REVIEW', ['YES', 'YES']);
    const view = projectTimeline({
      ...input,
      answers: [
        ...input.answers,
        { id: 'a2', textId: 't1', body: 'Mine was worse…', authorPlayerId: 'p1', skipped: false },
      ],
    });

    const answers = view.texts.find((text) => text.id === 't1')?.answers ?? [];

    expect(answers).toHaveLength(2);
    expect(answers.map((answer) => answer.body)).toEqual(['I once…', 'Mine was worse…']);
    expect(answers.every((answer) => answer.author === null)).toBe(true);
  });

  it('keeps a text with no answers at all in the timeline', () => {
    // Reachable after a forced advance: the text was written, nobody got round to answering it.
    const input = baseTimeline('REVIEW', ['YES', 'YES']);
    const view = projectTimeline({ ...input, answers: [] });

    expect(view.texts).toHaveLength(2);
    expect(view.texts.every((text) => text.answers.length === 0)).toBe(true);
  });

  it('copes with a timeline that has nothing in it', () => {
    const view = projectTimeline({
      phase: 'COMPLETED',
      outcome: computeRevealOutcome([], []),
      viewerPlayerId: 'p0',
      players: [],
      texts: [],
      answers: [],
      comments: [],
      guesses: [],
    });

    expect(view.texts).toEqual([]);
    expect(view.guessScores).toBeNull();
  });

  it('tolerates a reference to a player who is no longer listed', () => {
    // An account removed between the game and the reveal must not crash the timeline: an author
    // we cannot name simply stays anonymous.
    const input = baseTimeline('COMPLETED', ['YES', 'YES']);
    const view = projectTimeline({ ...input, players: [{ playerId: 'p0', username: 'sarah' }] });
    const text = view.texts.find((entry) => entry.id === 't1');

    expect(text?.author).toBeNull();
    // The guess was p0's, and p0 is still listed, so their score still stands…
    expect(view.guessScores).toEqual([
      { player: { playerId: 'p0', username: 'sarah' }, correct: 1, total: 1 },
    ]);
    // …but the player they guessed cannot be named.
    expect(text?.yourGuess).toBeNull();
  });

  it('omits a guesser who is no longer listed from the scores', () => {
    const input = baseTimeline('COMPLETED', ['YES', 'YES']);
    const view = projectTimeline({
      ...input,
      players: [{ playerId: 'p1', username: 'ahmed' }],
      guesses: [{ textId: 't1', guesserPlayerId: 'p0', guessedPlayerId: 'p1' }],
    });

    expect(view.guessScores).toEqual([]);
  });
});
