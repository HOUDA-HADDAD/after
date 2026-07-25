import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PunishmentAction, type PrismaClient } from '@prisma/client';
import { testPrisma, resetDatabase, disconnectTestPrisma } from '../helpers/prisma.js';
import { makeAnswerableSession } from '../helpers/factories.js';

/**
 * "Do not permanently store completed games" (D11), proven at the schema level.
 *
 * The claim is that purging a finished game is a single `DELETE FROM game_sessions`, that it
 * removes every trace of content *and* the mapping from anonymous identity back to a real
 * account, and that the punishment audit survives it. All three are properties of the cascade
 * graph, so they belong in a test rather than in a comment.
 */
describe('session purge cascade', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  /** Build a session carrying one of everything the transient zone can hold. */
  const makeFullyPopulatedSession = async () => {
    const { session, players, texts, group } = await makeAnswerableSession(prisma, 3);

    const assignment = await prisma.textAssignment.create({
      data: { sessionId: session.id, textId: texts[0]!.id, receiverPlayerId: players[1]!.id },
    });
    const answer = await prisma.answer.create({
      data: { assignmentId: assignment.id, sessionId: session.id, body: 'an answer' },
    });
    await prisma.comment.create({
      data: {
        sessionId: session.id,
        answerId: answer.id,
        authorPlayerId: players[2]!.id,
        body: 'that is hilarious',
        isAnonymous: true,
      },
    });
    await prisma.authorGuess.create({
      data: {
        sessionId: session.id,
        textId: texts[0]!.id,
        guesserPlayerId: players[1]!.id,
        guessedPlayerId: players[2]!.id,
      },
    });
    await prisma.revealVote.create({
      data: { sessionId: session.id, playerId: players[0]!.id, choice: 'YES' },
    });

    return { session, group, players };
  };

  it('removes every trace of the game in one statement', async () => {
    const { session } = await makeFullyPopulatedSession();

    await prisma.gameSession.delete({ where: { id: session.id } });

    expect(await prisma.gamePlayer.count()).toBe(0);
    expect(await prisma.gameText.count()).toBe(0);
    expect(await prisma.textAssignment.count()).toBe(0);
    expect(await prisma.answer.count()).toBe(0);
    expect(await prisma.comment.count()).toBe(0);
    expect(await prisma.authorGuess.count()).toBe(0);
    expect(await prisma.revealVote.count()).toBe(0);
  });

  it('keeps the durable zone intact', async () => {
    const { session } = await makeFullyPopulatedSession();

    await prisma.gameSession.delete({ where: { id: session.id } });

    // Users, groups and memberships are permanent; only the game was temporary.
    expect(await prisma.user.count()).toBe(3);
    expect(await prisma.group.count()).toBe(1);
    expect(await prisma.groupMembership.count()).toBe(3);
    expect(await prisma.theme.count()).toBe(1);
  });

  it('preserves the punishment audit trail, with the session reference nulled', async () => {
    const { session, group, players } = await makeFullyPopulatedSession();

    const event = await prisma.punishmentEvent.create({
      data: {
        groupId: group.id,
        targetUserId: players[1]!.userId,
        actorUserId: players[0]!.userId,
        action: PunishmentAction.PUNISH,
        resultingLevel: 1,
        gameSessionId: session.id,
      },
    });

    await prisma.gameSession.delete({ where: { id: session.id } });

    // Without this, "three consecutive punishments" would be unauditable and a host could be
    // accused of anything (docs/03-database-schema.md).
    const survivor = await prisma.punishmentEvent.findUnique({ where: { id: event.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.resultingLevel).toBe(1);
    expect(survivor?.gameSessionId).toBeNull();
  });

  it('destroys the mapping from session identity back to a real account', async () => {
    const { session } = await makeFullyPopulatedSession();
    expect(await prisma.gamePlayer.count()).toBe(3);

    await prisma.gameSession.delete({ where: { id: session.id } });

    // game_players is the only table linking a GamePlayer id to a user id. Once it is gone,
    // nothing that survives can attribute anything to anyone.
    expect(await prisma.gamePlayer.count()).toBe(0);
  });

  it('deletes a whole group without tripping over a live game', async () => {
    const { group } = await makeFullyPopulatedSession();

    await prisma.group.delete({ where: { id: group.id } });

    expect(await prisma.gameSession.count()).toBe(0);
    expect(await prisma.groupMembership.count()).toBe(0);
    expect(await prisma.punishmentEvent.count()).toBe(0);
  });

  it('refuses to delete a user who still owns a group', async () => {
    // Restrict, not cascade: deleting an account must not silently destroy other people's group.
    const { group } = await makeFullyPopulatedSession();
    const owner = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });

    await expect(prisma.user.delete({ where: { id: owner.ownerId } })).rejects.toThrow();
  });

  it('finds sessions whose grace window has elapsed', async () => {
    const { session } = await makeFullyPopulatedSession();
    const past = new Date(Date.now() - 60_000);

    await prisma.gameSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', purgeAfter: past },
    });

    const due = await prisma.gameSession.findMany({ where: { purgeAfter: { lte: new Date() } } });
    expect(due.map((row) => row.id)).toEqual([session.id]);
  });
});
