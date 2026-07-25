import type {
  Answer,
  AuthorGuess,
  Comment,
  GamePlayer,
  GameSession,
  GameText,
  RevealVote,
  SessionStatus,
  TextAssignment,
  Theme,
} from '@prisma/client';
import type { DbClient } from '../../lib/db.js';

export type SessionWithTheme = GameSession & { theme: Theme };
export type PlayerWithUser = GamePlayer & { user: { id: string; username: string } };
export type AssignmentWithText = TextAssignment & { text: GameText; answer: Answer | null };

export interface CreateSessionInput {
  groupId: string;
  themeId: string;
  createdById: string;
  distributionSeed: bigint;
  displaySeed: bigint;
}

export const createSessionsRepository = (db: DbClient) => ({
  /* ---- sessions ---------------------------------------------------------------------- */

  async create(input: CreateSessionInput): Promise<GameSession> {
    return db.gameSession.create({
      data: {
        groupId: input.groupId,
        themeId: input.themeId,
        createdById: input.createdById,
        distributionSeed: input.distributionSeed,
        displaySeed: input.displaySeed,
      },
    });
  },

  async findById(sessionId: string): Promise<SessionWithTheme | null> {
    return db.gameSession.findUnique({ where: { id: sessionId }, include: { theme: true } });
  },

  /** The group's live game, if it has one. A partial unique index guarantees at most one (D12). */
  async findLiveForGroup(groupId: string): Promise<SessionWithTheme | null> {
    return db.gameSession.findFirst({
      where: { groupId, status: { notIn: ['COMPLETED', 'CANCELLED', 'ABANDONED'] } },
      include: { theme: true },
    });
  },

  /**
   * Move the session forward, but only from the status we based the decision on.
   *
   * Every phase change goes through here. The status condition is what makes a transition
   * idempotent under concurrency: twenty simultaneous "last text submitted" requests all compute
   * the same next phase, and exactly one of them changes a row.
   */
  async advanceStatus(
    sessionId: string,
    from: SessionStatus,
    to: SessionStatus,
    extra: {
      startedAt?: Date;
      endedAt?: Date;
      purgeAfter?: Date;
      requiredTextCount?: number;
    } = {},
  ): Promise<boolean> {
    const { count } = await db.gameSession.updateMany({
      where: { id: sessionId, status: from },
      data: {
        status: to,
        version: { increment: 1 },
        lastActivityAt: new Date(),
        ...extra,
      },
    });

    return count === 1;
  },

  async touch(sessionId: string): Promise<void> {
    await db.gameSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });
  },

  /**
   * Take the session row's write lock.
   *
   * Used to serialise the distribution critical section: whoever holds this lock is the only one
   * building assignments, and everybody else waits and then sees the phase already advanced.
   */
  async lockForUpdate(sessionId: string): Promise<void> {
    await db.$queryRaw`SELECT id FROM "game_sessions" WHERE id = ${sessionId}::uuid FOR UPDATE`;
  },

  async delete(sessionId: string): Promise<void> {
    await db.gameSession.delete({ where: { id: sessionId } });
  },

  /* ---- players ----------------------------------------------------------------------- */

  async addPlayer(
    sessionId: string,
    userId: string,
    membershipId: string,
    punishmentLevel: number,
  ): Promise<GamePlayer> {
    return db.gamePlayer.create({
      data: { sessionId, userId, membershipId, punishmentLevelAtStart: punishmentLevel },
    });
  },

  async listPlayers(sessionId: string): Promise<PlayerWithUser[]> {
    return db.gamePlayer.findMany({
      where: { sessionId },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { joinedAt: 'asc' },
    });
  },

  async findPlayer(sessionId: string, userId: string): Promise<GamePlayer | null> {
    return db.gamePlayer.findUnique({ where: { sessionId_userId: { sessionId, userId } } });
  },

  async removePlayer(playerId: string): Promise<void> {
    await db.gamePlayer.delete({ where: { id: playerId } });
  },

  async markPlayerLeft(playerId: string, at: Date): Promise<void> {
    await db.gamePlayer.update({ where: { id: playerId }, data: { leftAt: at } });
  },

  /**
   * Freeze this player's punishment level and answer load.
   *
   * Written at distribution time, not at join time: a host may punish someone after they have
   * joined the lobby, and the load has to reflect the level they actually start the game with
   * (D6). Once written, a host cannot change a player's load mid-game.
   */
  async setDistributionSnapshot(playerId: string, level: number, quota: number): Promise<void> {
    await db.gamePlayer.update({
      where: { id: playerId },
      data: { punishmentLevelAtStart: level, receiveQuota: quota },
    });
  },

  async markPunishedThisSession(sessionId: string, userId: string): Promise<void> {
    await db.gamePlayer.updateMany({
      where: { sessionId, userId },
      data: { wasPunishedThisSession: true },
    });
  },

  /* ---- texts ------------------------------------------------------------------------- */

  async upsertText(
    sessionId: string,
    authorPlayerId: string,
    body: string,
    submitted: boolean,
    displayOrder: number,
  ): Promise<GameText> {
    return db.gameText.upsert({
      where: { sessionId_authorPlayerId: { sessionId, authorPlayerId } },
      create: {
        sessionId,
        authorPlayerId,
        body,
        displayOrder,
        status: submitted ? 'SUBMITTED' : 'DRAFT',
        ...(submitted ? { submittedAt: new Date() } : {}),
      },
      update: {
        body,
        status: submitted ? 'SUBMITTED' : 'DRAFT',
        ...(submitted ? { submittedAt: new Date() } : {}),
      },
    });
  },

  /**
   * Fix a text's position in the timeline.
   *
   * Separate from `upsertText` on purpose. Writing the order through the upsert meant the
   * `update` branch silently dropped it, so every text kept order 0 and the timeline fell back
   * to insertion order — which is submission order, which identifies the fastest typist. The
   * anonymity suite caught it; a dedicated method makes the write unmissable.
   */
  async setDisplayOrder(textId: string, displayOrder: number): Promise<void> {
    await db.gameText.update({ where: { id: textId }, data: { displayOrder } });
  },

  async findTextByAuthor(sessionId: string, authorPlayerId: string): Promise<GameText | null> {
    return db.gameText.findUnique({
      where: { sessionId_authorPlayerId: { sessionId, authorPlayerId } },
    });
  },

  async listSubmittedTexts(sessionId: string): Promise<GameText[]> {
    return db.gameText.findMany({
      where: { sessionId, status: 'SUBMITTED' },
      orderBy: { displayOrder: 'asc' },
    });
  },

  async countSubmittedTexts(sessionId: string): Promise<number> {
    return db.gameText.count({ where: { sessionId, status: 'SUBMITTED' } });
  },

  /** Drafts never reach the timeline; a forced advance discards them. */
  async deleteDraftTexts(sessionId: string): Promise<void> {
    await db.gameText.deleteMany({ where: { sessionId, status: 'DRAFT' } });
  },

  /* ---- assignments and answers -------------------------------------------------------- */

  async createAssignments(
    sessionId: string,
    assignments: readonly { textId: string; receiverPlayerId: string }[],
  ): Promise<void> {
    await db.textAssignment.createMany({
      data: assignments.map((assignment) => ({ sessionId, ...assignment })),
    });
  },

  async listAssignmentsForPlayer(playerId: string): Promise<AssignmentWithText[]> {
    return db.textAssignment.findMany({
      where: { receiverPlayerId: playerId },
      include: { text: true, answer: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async findAssignment(assignmentId: string): Promise<AssignmentWithText | null> {
    return db.textAssignment.findUnique({
      where: { id: assignmentId },
      include: { text: true, answer: true },
    });
  },

  async countAssignments(sessionId: string): Promise<number> {
    return db.textAssignment.count({ where: { sessionId } });
  },

  async countSubmittedAnswers(sessionId: string): Promise<number> {
    return db.answer.count({ where: { sessionId, status: 'SUBMITTED' } });
  },

  async upsertAnswer(
    assignmentId: string,
    sessionId: string,
    body: string,
    submitted: boolean,
  ): Promise<Answer> {
    const answer = await db.answer.upsert({
      where: { assignmentId },
      create: {
        assignmentId,
        sessionId,
        body,
        status: submitted ? 'SUBMITTED' : 'DRAFT',
        ...(submitted ? { submittedAt: new Date() } : {}),
      },
      update: {
        body,
        status: submitted ? 'SUBMITTED' : 'DRAFT',
        ...(submitted ? { submittedAt: new Date() } : {}),
      },
    });

    if (submitted) {
      await db.textAssignment.update({ where: { id: assignmentId }, data: { status: 'ANSWERED' } });
    }

    return answer;
  },

  /** Anything still unanswered when the host ends the phase shows as "no answer" (D14). */
  async markUnansweredSkipped(sessionId: string): Promise<void> {
    await db.textAssignment.updateMany({
      where: { sessionId, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    await db.answer.deleteMany({ where: { sessionId, status: 'DRAFT' } });
  },

  async listAnswers(sessionId: string): Promise<(Answer & { assignment: TextAssignment })[]> {
    return db.answer.findMany({
      where: { sessionId, status: 'SUBMITTED' },
      include: { assignment: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async listSkippedAssignments(sessionId: string): Promise<TextAssignment[]> {
    return db.textAssignment.findMany({ where: { sessionId, status: 'SKIPPED' } });
  },

  /* ---- comments, guesses, votes ------------------------------------------------------- */

  async createComment(
    sessionId: string,
    answerId: string,
    authorPlayerId: string,
    body: string,
    isAnonymous: boolean,
  ): Promise<Comment> {
    return db.comment.create({
      data: { sessionId, answerId, authorPlayerId, body, isAnonymous },
    });
  },

  async listComments(sessionId: string): Promise<Comment[]> {
    return db.comment.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
  },

  async findAnswerById(answerId: string): Promise<Answer | null> {
    return db.answer.findUnique({ where: { id: answerId } });
  },

  async upsertGuess(
    sessionId: string,
    textId: string,
    guesserPlayerId: string,
    guessedPlayerId: string,
  ): Promise<AuthorGuess> {
    return db.authorGuess.upsert({
      where: { textId_guesserPlayerId: { textId, guesserPlayerId } },
      create: { sessionId, textId, guesserPlayerId, guessedPlayerId },
      update: { guessedPlayerId },
    });
  },

  async listGuesses(sessionId: string): Promise<AuthorGuess[]> {
    return db.authorGuess.findMany({ where: { sessionId } });
  },

  async castRevealVote(
    sessionId: string,
    playerId: string,
    choice: 'YES' | 'NO',
  ): Promise<RevealVote> {
    return db.revealVote.upsert({
      where: { playerId },
      create: { sessionId, playerId, choice },
      update: { choice },
    });
  },

  /**
   * The reveal votes.
   *
   * **The only method permitted to read this table.** Callers turn the rows into a single
   * collective outcome via `computeRevealOutcome`; nothing else may look at an individual
   * `choice`, and the yes/no split is never computed anywhere (D8a).
   */
  async listRevealVotes(sessionId: string): Promise<RevealVote[]> {
    return db.revealVote.findMany({ where: { sessionId } });
  },

  async hasVoted(playerId: string): Promise<boolean> {
    return (await db.revealVote.count({ where: { playerId } })) > 0;
  },

  /* ---- scheduled maintenance ----------------------------------------------------------- */

  async findDueForPurge(now: Date, limit: number): Promise<{ id: string }[]> {
    return db.gameSession.findMany({
      where: { purgeAfter: { lte: now } },
      select: { id: true },
      take: limit,
    });
  },

  async findStale(before: Date, limit: number): Promise<{ id: string; status: SessionStatus }[]> {
    return db.gameSession.findMany({
      where: {
        lastActivityAt: { lt: before },
        status: { in: ['LOBBY', 'WRITING', 'ANSWERING', 'REVIEW'] },
      },
      select: { id: true, status: true },
      take: limit,
    });
  },
});

export type SessionsRepository = ReturnType<typeof createSessionsRepository>;
