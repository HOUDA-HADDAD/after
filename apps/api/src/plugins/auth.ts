import fp from 'fastify-plugin';
import { UnauthenticatedError } from '@aftergame/shared';
import type { User } from '@prisma/client';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '@aftergame/config';
import { argon2ParamsFrom, createPasswordHasher } from '../lib/password.js';
import { createAttemptLimiter } from '../lib/attempt-limiter.js';
import { createAuthRepository } from '../modules/auth/auth.repository.js';
import { createAuthService, type AuthService } from '../modules/auth/auth.service.js';
import {
  sessionCookieName,
  sessionCookieOptions,
  clearedSessionCookieOptions,
} from '../modules/auth/auth.cookies.js';

/** Per-account credential limits. The per-IP dimension is handled by @fastify/rate-limit. */
const LOGIN_ATTEMPTS_PER_ACCOUNT = 10;
const LOGIN_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

declare module 'fastify' {
  interface FastifyInstance {
    auth: AuthService;
    /** preHandler that rejects the request with 401 unless a live session is present. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Attaches the user when signed in, without rejecting anonymous callers. */
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Issue or clear the session cookie. Used by the auth routes. */
    sessionCookie: {
      set(reply: FastifyReply, token: string, expiresAt: Date): void;
      clear(reply: FastifyReply): void;
      read(request: FastifyRequest): string;
    };
  }

  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
  }
}

/**
 * Authentication.
 *
 * Session resolution is **lazy**: routes opt in with `preHandler: app.requireAuth`, so a request
 * for a static asset or a health probe never touches the database. That is cheaper than an
 * onRequest hook on every request, and it makes each route state its own requirement in a line
 * anyone can read.
 */
const authPlugin: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const passwords = createPasswordHasher(argon2ParamsFrom(env));

  const auth = createAuthService({
    repository: createAuthRepository(app.prisma),
    passwords,
    loginLimiter: createAttemptLimiter({
      max: LOGIN_ATTEMPTS_PER_ACCOUNT,
      windowMs: LOGIN_ATTEMPT_WINDOW_MS,
    }),
    env,
  });

  const cookieName = sessionCookieName(env);
  const maxAgeSeconds = env.SESSION_TTL_DAYS * 24 * 60 * 60;

  app.decorate('auth', auth);
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.decorate('sessionCookie', {
    set(reply: FastifyReply, token: string, _expiresAt: Date) {
      reply.setCookie(cookieName, token, sessionCookieOptions(env, maxAgeSeconds));
    },
    clear(reply: FastifyReply) {
      reply.clearCookie(cookieName, clearedSessionCookieOptions(env));
    },
    read(request: FastifyRequest) {
      return request.cookies[cookieName] ?? '';
    },
  });

  /** Resolve the cookie into a user, refreshing the cookie when sliding expiry moved it. */
  const attachUser = async (request: FastifyRequest, reply: FastifyReply): Promise<User | null> => {
    const token = app.sessionCookie.read(request);
    const resolved = await auth.resolve(token);

    if (resolved === null) {
      // A cookie that no longer resolves is stale — clear it so the browser stops sending it.
      if (token !== '') app.sessionCookie.clear(reply);
      return null;
    }

    request.user = resolved.user;
    request.sessionId = resolved.sessionId;

    if (resolved.renewedExpiresAt !== undefined) {
      app.sessionCookie.set(reply, token, resolved.renewedExpiresAt);
    }

    return resolved.user;
  };

  app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await attachUser(request, reply)) === null) {
      throw new UnauthenticatedError('Sign in to continue.');
    }
  });

  app.decorate('optionalAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    await attachUser(request, reply);
  });

  // Precompute the dummy hash used by the unknown-email path, so the first failed login is not
  // measurably slower than every subsequent one.
  app.addHook('onReady', async () => {
    await passwords.warmUp();
  });
};

export default fp(authPlugin, { name: 'auth', dependencies: ['prisma'] });
