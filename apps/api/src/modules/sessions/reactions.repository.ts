import type { DbClient } from '../../lib/db.js';

/** One answer's tally: how many people chose each emoji, and whether the viewer was one. */
export interface ReactionTally {
  answerId: string;
  emoji: string;
  count: number;
  youReacted: boolean;
}

/**
 * Reactions, counted.
 *
 * The table records who reacted — it has to, so a player can take their own back and cannot
 * remove anyone else's. This repository is the boundary where that stops: every read returns
 * counts plus a single `youReacted` flag for the asking player, and there is no method that
 * returns a reactor list. A projection cannot leak what it was never handed (D20).
 */
export const createReactionsRepository = (db: DbClient) => ({
  /**
   * Every tally in a session, in one pass.
   *
   * Grouping in the database rather than fetching rows and counting in memory is not only faster;
   * it means the identities never leave PostgreSQL at all, except for the viewer's own.
   */
  async tallyForSession(sessionId: string, viewerPlayerId: string): Promise<ReactionTally[]> {
    const grouped = await db.reaction.groupBy({
      by: ['answerId', 'emoji'],
      where: { sessionId },
      _count: { _all: true },
    });

    const mine = await db.reaction.findMany({
      where: { sessionId, playerId: viewerPlayerId },
      select: { answerId: true, emoji: true },
    });

    const own = new Set(mine.map((row) => `${row.answerId}:${row.emoji}`));

    return grouped.map((row) => ({
      answerId: row.answerId,
      emoji: row.emoji,
      count: row._count._all,
      youReacted: own.has(`${row.answerId}:${row.emoji}`),
    }));
  },

  /**
   * Add a reaction, or report that it was already there.
   *
   * The unique index makes a double tap idempotent rather than a second row, so a flaky
   * connection retrying a request cannot inflate a count.
   */
  async add(
    sessionId: string,
    answerId: string,
    playerId: string,
    emoji: string,
  ): Promise<boolean> {
    const result = await db.reaction.createMany({
      data: [{ sessionId, answerId, playerId, emoji }],
      skipDuplicates: true,
    });

    return result.count > 0;
  },

  /** Remove the viewer's own reaction. Scoped by `playerId`, so it can only ever remove theirs. */
  async remove(answerId: string, playerId: string, emoji: string): Promise<boolean> {
    const result = await db.reaction.deleteMany({ where: { answerId, playerId, emoji } });

    return result.count > 0;
  },

  /** Whether an answer belongs to this session — checked before a reaction is recorded. */
  async answerBelongsToSession(answerId: string, sessionId: string): Promise<boolean> {
    return (await db.answer.count({ where: { id: answerId, sessionId } })) > 0;
  },
});

export type ReactionsRepository = ReturnType<typeof createReactionsRepository>;
