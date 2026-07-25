import { isTerminal, type SessionPhase } from './phases.js';

/**
 * The anonymity boundary.
 *
 * Anonymity is the product, so deciding who may see whose name is a security control, not a UI
 * concern. Every payload the server sends — REST and WebSocket alike — passes through the
 * projections here, and they are the only code permitted to look at an author id.
 *
 * The rule they enforce (D8): authors are revealed **to everyone or to nobody**, and only when
 * every remaining participant voted yes. Abstention counts as no, because silence must never
 * authorise disclosure.
 */

export type RevealChoice = 'YES' | 'NO';

export interface ParticipantVote {
  playerId: string;
  choice: RevealChoice;
}

export interface RevealParticipant {
  playerId: string;
  /** Players who walked away before the vote are excluded from the denominator (D8). */
  hasLeft: boolean;
}

export interface RevealOutcome {
  /** True only if every remaining participant voted YES. */
  revealed: boolean;
  /** How many have answered the prompt. The yes/no split is never computed (D8a). */
  decided: number;
  total: number;
  /** True once nobody is left to answer. */
  everyoneDecided: boolean;
}

/**
 * Combine the private votes into one collective outcome.
 *
 * Note what this returns and what it does not: a boolean and two counts. The split is not
 * computed here or anywhere else, because "5 of 8 voted yes" identifies the refuser in a small
 * group — and in a two-player game it identifies them exactly.
 */
export function computeRevealOutcome(
  participants: readonly RevealParticipant[],
  votes: readonly ParticipantVote[],
): RevealOutcome {
  const remaining = participants.filter((participant) => !participant.hasLeft);
  const voteByPlayer = new Map(votes.map((vote) => [vote.playerId, vote.choice]));

  const decided = remaining.filter((participant) => voteByPlayer.has(participant.playerId)).length;

  const everyoneAgreed =
    remaining.length > 0 &&
    remaining.every((participant) => voteByPlayer.get(participant.playerId) === 'YES');

  return {
    revealed: everyoneAgreed,
    decided,
    total: remaining.length,
    everyoneDecided: decided === remaining.length,
  };
}

export interface Entitlement {
  /** May this viewer see who wrote what? Identical for everyone in the session, by design. */
  authorsVisible: boolean;
}

/**
 * Authors become visible only once voting is over *and* unanimous.
 *
 * Gating on the phase as well as the vote matters: a unanimous-so-far tally halfway through
 * `REVEAL` must not leak names to whoever refreshes at the right moment.
 */
export function entitlementFor(phase: SessionPhase, outcome: RevealOutcome): Entitlement {
  const votingFinished = isTerminal(phase);

  return { authorsVisible: votingFinished && outcome.revealed };
}

/* ------------------------------------------------------------------------------------------ */
/* Projections                                                                                  */
/* ------------------------------------------------------------------------------------------ */

export interface PlayerRef {
  playerId: string;
  username: string;
}

export interface TextRecord {
  id: string;
  body: string;
  authorPlayerId: string;
  displayOrder: number;
}

export interface AnswerRecord {
  id: string;
  textId: string;
  body: string | null;
  /** The receiver who answered. Null body means they never did (a forced advance). */
  authorPlayerId: string;
  skipped: boolean;
}

export interface CommentRecord {
  id: string;
  answerId: string;
  body: string;
  authorPlayerId: string;
  isAnonymous: boolean;
  createdAt: string;
}

export interface GuessRecord {
  textId: string;
  guesserPlayerId: string;
  guessedPlayerId: string;
}

export interface TimelineInput {
  phase: SessionPhase;
  outcome: RevealOutcome;
  /** The viewer, so their own guesses can be shown back to them. */
  viewerPlayerId: string;
  players: readonly PlayerRef[];
  texts: readonly TextRecord[];
  answers: readonly AnswerRecord[];
  comments: readonly CommentRecord[];
  guesses: readonly GuessRecord[];
}

export interface CommentView {
  id: string;
  body: string;
  /** Null for an anonymous comment — forever, in every phase, for everyone. */
  author: PlayerRef | null;
  createdAt: string;
}

export interface AnswerView {
  id: string;
  body: string | null;
  author: PlayerRef | null;
  skipped: boolean;
  comments: CommentView[];
}

export interface TextView {
  id: string;
  body: string;
  author: PlayerRef | null;
  answers: AnswerView[];
  /** The viewer's own guess, if they made one. */
  yourGuess: PlayerRef | null;
  /** Whether that guess was right — only once authors are revealed (D9). */
  yourGuessCorrect: boolean | null;
}

export interface TimelineView {
  authorsVisible: boolean;
  texts: TextView[];
  /** Present only when authors are revealed; otherwise nobody gets a score. */
  guessScores: { player: PlayerRef; correct: number; total: number }[] | null;
}

/**
 * Assemble the timeline for one viewer.
 *
 * Everything identity-bearing flows through here. A field is either populated because the viewer
 * is entitled to it, or it is `null` — never sent-but-hidden, because "hidden" in a JSON payload
 * is not hidden at all.
 */
export function projectTimeline(input: TimelineInput): TimelineView {
  const { authorsVisible } = entitlementFor(input.phase, input.outcome);
  const playerById = new Map(input.players.map((player) => [player.playerId, player]));

  const identify = (playerId: string): PlayerRef | null =>
    authorsVisible ? (playerById.get(playerId) ?? null) : null;

  const commentsByAnswer = new Map<string, CommentRecord[]>();
  for (const comment of input.comments) {
    const bucket = commentsByAnswer.get(comment.answerId);
    if (bucket === undefined) commentsByAnswer.set(comment.answerId, [comment]);
    else bucket.push(comment);
  }

  const answersByText = new Map<string, AnswerRecord[]>();
  for (const answer of input.answers) {
    const bucket = answersByText.get(answer.textId);
    if (bucket === undefined) answersByText.set(answer.textId, [answer]);
    else bucket.push(answer);
  }

  const guessByText = new Map(
    input.guesses
      .filter((guess) => guess.guesserPlayerId === input.viewerPlayerId)
      .map((guess) => [guess.textId, guess.guessedPlayerId]),
  );

  const projectComment = (comment: CommentRecord): CommentView => ({
    id: comment.id,
    body: comment.body,
    // An anonymous comment stays anonymous even after the reveal. That promise is made when the
    // person presses Post, and the reveal vote is not theirs to override (D17).
    author: comment.isAnonymous ? null : (playerById.get(comment.authorPlayerId) ?? null),
    createdAt: comment.createdAt,
  });

  const texts = [...input.texts]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((text): TextView => {
      const guessedPlayerId = guessByText.get(text.id);

      return {
        id: text.id,
        body: text.body,
        author: identify(text.authorPlayerId),
        answers: (answersByText.get(text.id) ?? []).map((answer) => ({
          id: answer.id,
          body: answer.body,
          author: identify(answer.authorPlayerId),
          skipped: answer.skipped,
          comments: (commentsByAnswer.get(answer.id) ?? []).map(projectComment),
        })),
        // The viewer always sees the guess they made — they already know what they picked.
        yourGuess: guessedPlayerId === undefined ? null : (playerById.get(guessedPlayerId) ?? null),
        // Whether it was right is a different matter: telling them discloses the author just as
        // surely as naming them, so it waits for the reveal (D9).
        yourGuessCorrect:
          authorsVisible && guessedPlayerId !== undefined
            ? guessedPlayerId === text.authorPlayerId
            : null,
      };
    });

  return {
    authorsVisible,
    texts,
    guessScores: authorsVisible ? scoreGuesses(input, playerById) : null,
  };
}

function scoreGuesses(
  input: TimelineInput,
  playerById: ReadonlyMap<string, PlayerRef>,
): { player: PlayerRef; correct: number; total: number }[] {
  const authorByText = new Map(input.texts.map((text) => [text.id, text.authorPlayerId]));
  const tally = new Map<string, { correct: number; total: number }>();

  for (const guess of input.guesses) {
    const entry = tally.get(guess.guesserPlayerId) ?? { correct: 0, total: 0 };

    entry.total += 1;
    if (authorByText.get(guess.textId) === guess.guessedPlayerId) entry.correct += 1;

    tally.set(guess.guesserPlayerId, entry);
  }

  const scores: { player: PlayerRef; correct: number; total: number }[] = [];

  for (const [playerId, entry] of tally) {
    const player = playerById.get(playerId);
    if (player === undefined) continue;

    scores.push({ player, correct: entry.correct, total: entry.total });
  }

  return scores.sort((left, right) => right.correct - left.correct);
}
