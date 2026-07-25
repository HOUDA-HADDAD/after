import { createHash } from 'node:crypto';
import type { User } from '@prisma/client';
import type { Env } from '@aftergame/config';
import {
  AppError,
  ConflictError,
  ERROR_CODES,
  RateLimitedError,
  type LoginInput,
  type RegisterInput,
} from '@aftergame/shared';
import { isUniqueViolation } from '../../lib/db.js';
import { generateSessionToken, hashSessionToken } from '../../lib/tokens.js';
import type { PasswordHasher } from '../../lib/password.js';
import type { AttemptLimiter } from '../../lib/attempt-limiter.js';
import type { AuthRepository, SessionWithUser } from './auth.repository.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How stale a session may get before we extend it.
 *
 * Sliding expiry without this would mean a database write on every authenticated request, for a
 * value that changes meaningfully once a month.
 */
const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000;

export interface RequestContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface IssuedSession {
  user: User;
  token: string;
  expiresAt: Date;
}

export interface ResolvedSession {
  user: User;
  sessionId: string;
  /** Set when sliding expiry moved the expiry, so the route can refresh the cookie. */
  renewedExpiresAt?: Date;
}

export interface AuthServiceDeps {
  repository: AuthRepository;
  passwords: PasswordHasher;
  /** Per-account credential limiter; see lib/attempt-limiter.ts. */
  loginLimiter: AttemptLimiter;
  env: Env;
  now?: () => Date;
}

/** Wrong password and no such account are the same answer, deliberately. */
const invalidCredentials = (): AppError =>
  new AppError(ERROR_CODES.INVALID_CREDENTIALS, 401, 'Email or password is incorrect');

export function createAuthService({
  repository,
  passwords,
  loginLimiter,
  env,
  now = () => new Date(),
}: AuthServiceDeps) {
  const ttlMs = env.SESSION_TTL_DAYS * MILLISECONDS_PER_DAY;

  /**
   * IP addresses are personal data and we only need them to help someone recognise a session in
   * a "sign out other devices" list. Hashing with the app secret keeps them useful for that and
   * useless for anything else.
   */
  const hashIp = (ip: string | undefined): string | undefined =>
    ip === undefined
      ? undefined
      : createHash('sha256').update(`${env.SESSION_SECRET}:${ip}`).digest('hex').slice(0, 32);

  const issueSession = async (user: User, context: RequestContext): Promise<IssuedSession> => {
    const token = generateSessionToken();
    const expiresAt = new Date(now().getTime() + ttlMs);

    await repository.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: context.userAgent?.slice(0, 400),
      ipHash: hashIp(context.ip),
    });

    return { user, token, expiresAt };
  };

  return {
    /**
     * Create an account and sign in.
     *
     * Registration signs the user in directly: a second login form immediately after signup is
     * friction with no security benefit.
     */
    async register(input: RegisterInput, context: RequestContext): Promise<IssuedSession> {
      const passwordHash = await passwords.hash(input.password);

      try {
        const user = await repository.createUser({
          username: input.username,
          email: input.email,
          passwordHash,
        });

        return await issueSession(user, context);
      } catch (error) {
        // Availability is also checked by the unique indexes, so this is the authority rather
        // than a pre-flight SELECT that another registration could win a race against.
        if (isUniqueViolation(error, 'email')) {
          throw new ConflictError(
            ERROR_CODES.EMAIL_TAKEN,
            'That email already has an account',
            'Try signing in instead.',
          );
        }

        if (isUniqueViolation(error, 'username')) {
          throw new ConflictError(
            ERROR_CODES.USERNAME_TAKEN,
            'That username is taken',
            'Pick another one.',
          );
        }

        throw error;
      }
    },

    /**
     * Verify credentials and sign in.
     *
     * Two properties matter more than the happy path. First, every failure returns the same
     * error, so the response never distinguishes "no such account" from "wrong password".
     * Second, the unknown-email branch still performs a full argon2 verification against a dummy
     * hash — otherwise it would return in microseconds and response *timing* would leak exactly
     * what the identical error message was hiding.
     */
    async login(input: LoginInput, context: RequestContext): Promise<IssuedSession> {
      const email = input.email.trim();
      const limiterKey = email.toLowerCase();

      if (!loginLimiter.consume(limiterKey)) {
        throw new RateLimitedError('Too many sign-in attempts for this account. Try again later.');
      }

      const user = await repository.findUserByEmail(email);

      if (user === null) {
        await passwords.verifyAgainstDummy(input.password);
        throw invalidCredentials();
      }

      if (!(await passwords.verify(user.passwordHash, input.password))) {
        throw invalidCredentials();
      }

      // One forgotten password should not lock the account out for the rest of the window.
      loginLimiter.reset(limiterKey);

      return issueSession(user, context);
    },

    /**
     * Resolve a session token to its user, applying sliding expiry.
     *
     * Returns null for anything that is not a live session — unknown token, expired token,
     * malformed cookie — because the caller has no use for the distinction and neither does an
     * attacker.
     */
    async resolve(token: string): Promise<ResolvedSession | null> {
      if (token === '') return null;

      const session: SessionWithUser | null = await repository.findSessionByTokenHash(
        hashSessionToken(token),
      );

      if (session === null) return null;

      const current = now();

      if (session.expiresAt.getTime() <= current.getTime()) {
        // Expired sessions are removed on sight rather than left for the scheduled sweep.
        await repository.deleteSessionByTokenHash(session.tokenHash);
        return null;
      }

      const staleSince = current.getTime() - session.lastUsedAt.getTime();

      if (staleSince < SESSION_REFRESH_AFTER_MS) {
        return { user: session.user, sessionId: session.id };
      }

      const renewedExpiresAt = new Date(current.getTime() + ttlMs);
      await repository.touchSession(session.id, renewedExpiresAt, current);

      return { user: session.user, sessionId: session.id, renewedExpiresAt };
    },

    /** Delete the row, not just the cookie — a session must be dead server-side. */
    async logout(token: string): Promise<void> {
      if (token === '') return;
      await repository.deleteSessionByTokenHash(hashSessionToken(token));
    },

    /** Revoke every session for a user, including the caller's. */
    async logoutEverywhere(userId: string): Promise<number> {
      return repository.deleteSessionsForUser(userId);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
