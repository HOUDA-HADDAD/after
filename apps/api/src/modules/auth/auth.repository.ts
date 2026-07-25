import type { AuthSession, User } from '@prisma/client';
import type { DbClient } from '../../lib/db.js';
import type { TokenHash } from '../../lib/tokens.js';

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: TokenHash;
  expiresAt: Date;
  userAgent?: string | undefined;
  ipHash?: string | undefined;
}

export type SessionWithUser = AuthSession & { user: User };

export const createAuthRepository = (db: DbClient) => ({
  async createUser(input: CreateUserInput): Promise<User> {
    return db.user.create({ data: input });
  },

  /**
   * Case-insensitive by virtue of the `citext` column, so `Sarah@x.com` finds the account
   * created as `sarah@x.com` rather than silently allowing a second one.
   */
  async findUserByEmail(email: string): Promise<User | null> {
    return db.user.findUnique({ where: { email } });
  },

  async findUserById(id: string): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  },

  async createSession(input: CreateSessionInput): Promise<AuthSession> {
    return db.authSession.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
        ...(input.ipHash === undefined ? {} : { ipHash: input.ipHash }),
      },
    });
  },

  /** Lookup is by hash — the raw token exists only in the cookie and in memory for one request. */
  async findSessionByTokenHash(tokenHash: TokenHash): Promise<SessionWithUser | null> {
    return db.authSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  },

  /** Sliding expiry. Called at most once an hour per session, not on every request. */
  async touchSession(id: string, expiresAt: Date, now: Date): Promise<void> {
    await db.authSession.update({
      where: { id },
      data: { expiresAt, lastUsedAt: now },
    });
  },

  async deleteSessionByTokenHash(tokenHash: TokenHash): Promise<void> {
    // deleteMany, not delete: logging out twice is not an error worth raising.
    await db.authSession.deleteMany({ where: { tokenHash } });
  },

  /** "Sign out everywhere". `exceptId` keeps the current device signed in when that is wanted. */
  async deleteSessionsForUser(userId: string, exceptId?: string): Promise<number> {
    const { count } = await db.authSession.deleteMany({
      where: { userId, ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }) },
    });

    return count;
  },

  /**
   * Housekeeping for the scheduled job in Phase 6. Expired sessions are already rejected at
   * validation time, so this only stops the table growing.
   */
  async deleteExpiredSessions(now: Date): Promise<number> {
    const { count } = await db.authSession.deleteMany({ where: { expiresAt: { lte: now } } });
    return count;
  },
});

export type AuthRepository = ReturnType<typeof createAuthRepository>;
