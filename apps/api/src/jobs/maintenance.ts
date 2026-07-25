import type { FastifyInstance } from 'fastify';
import { createSessionsRepository } from '../modules/sessions/sessions.repository.js';
import { createAuthRepository } from '../modules/auth/auth.repository.js';

/** Distinct advisory-lock keys, so the three jobs never block one another. */
export const LOCK_KEYS = {
  purgeSessions: 811_001,
  abandonStale: 811_002,
  pruneAuthSessions: 811_003,
} as const;

/** How many rows a single pass will touch, so one sweep cannot monopolise the database. */
const BATCH_SIZE = 200;

export interface MaintenanceResult {
  purgedSessions: number;
  abandonedSessions: number;
  prunedAuthSessions: number;
}

/**
 * The scheduled work.
 *
 * Exported as plain functions taking the app, so the tests can run a sweep directly instead of
 * waiting for a timer — a job that is only exercised by cron is a job nobody has tested.
 */
export function createMaintenanceJobs(app: FastifyInstance) {
  const sessions = createSessionsRepository(app.prisma);
  const auth = createAuthRepository(app.prisma);

  return {
    /**
     * Delete finished games whose grace window has elapsed.
     *
     * One `DELETE` per session, and PostgreSQL cascades it through every text, assignment,
     * answer, comment, guess and vote — plus `game_players`, which is the only mapping from an
     * anonymous session identity back to a real account (D11). The punishment audit survives with
     * its session reference nulled.
     */
    async purgeSessions(now = new Date()): Promise<number> {
      const due = await sessions.findDueForPurge(now, BATCH_SIZE);

      for (const session of due) {
        await sessions.delete(session.id);
      }

      if (due.length > 0) app.log.info({ count: due.length }, 'purged expired sessions');

      return due.length;
    },

    /**
     * Abandon games nobody has touched for the idle TTL.
     *
     * Without this a group whose players all wandered off keeps its single live-game slot
     * occupied forever, and nobody can start another (D12).
     */
    async abandonStaleSessions(now = new Date()): Promise<number> {
      const cutoff = new Date(now.getTime() - env(app).SESSION_IDLE_TTL_MINUTES * 60_000);
      const stale = await sessions.findStale(cutoff, BATCH_SIZE);
      let abandoned = 0;

      for (const session of stale) {
        // Abandoning does not reset any punishment counter: an abandoned game is not "a game
        // played" (D5).
        if (
          await sessions.advanceStatus(session.id, session.status, 'ABANDONED', { endedAt: now })
        ) {
          abandoned += 1;
          app.events.emit('session.phase_changed', {
            sessionId: session.id,
            groupId: '',
            phase: 'ABANDONED',
          });
        }
      }

      if (abandoned > 0) app.log.info({ count: abandoned }, 'abandoned stale sessions');

      return abandoned;
    },

    /** Housekeeping only — expired sessions are already rejected at validation time. */
    async pruneAuthSessions(now = new Date()): Promise<number> {
      const pruned = await auth.deleteExpiredSessions(now);

      if (pruned > 0) app.log.info({ count: pruned }, 'pruned expired auth sessions');

      return pruned;
    },

    /** One full sweep, each part behind its own advisory lock. */
    async runAll(now = new Date()): Promise<MaintenanceResult> {
      let purgedSessions = 0;
      let abandonedSessions = 0;
      let prunedAuthSessions = 0;

      await app.withAdvisoryLock(LOCK_KEYS.abandonStale, async () => {
        abandonedSessions = await this.abandonStaleSessions(now);
      });

      await app.withAdvisoryLock(LOCK_KEYS.purgeSessions, async () => {
        purgedSessions = await this.purgeSessions(now);
      });

      await app.withAdvisoryLock(LOCK_KEYS.pruneAuthSessions, async () => {
        prunedAuthSessions = await this.pruneAuthSessions(now);
      });

      return { purgedSessions, abandonedSessions, prunedAuthSessions };
    },
  };
}

/** The env is on the app instance; this keeps the accessor in one place. */
const env = (app: FastifyInstance) => app.appEnv;

export type MaintenanceJobs = ReturnType<typeof createMaintenanceJobs>;
