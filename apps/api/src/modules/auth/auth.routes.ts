import { loginSchema, registerSchema } from '@aftergame/shared';
import type { FastifyPluginAsync } from 'fastify';
import { parseOrThrow } from '../../lib/validate.js';
import { sessionDtoJsonSchema, toUserDto } from './auth.mapper.js';

/**
 * Per-IP limits on the credential endpoints.
 *
 * Tight, because these are the only routes where an anonymous caller gets unlimited guesses.
 * The per-account dimension is enforced separately in the service — an attacker spreading
 * guesses for one account across many addresses would sail past an IP limit.
 */
const CREDENTIAL_RATE_LIMIT = {
  max: 5,
  timeWindow: '15 minutes',
} as const;

const authRoutes: FastifyPluginAsync = async (app) => {
  const requestContext = (request: { headers: Record<string, unknown>; ip: string }) => ({
    userAgent:
      typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
    ip: request.ip,
  });

  app.post(
    '/register',
    {
      config: { rateLimit: CREDENTIAL_RATE_LIMIT },
      schema: { response: { 201: sessionDtoJsonSchema } },
    },
    async (request, reply) => {
      const input = parseOrThrow(registerSchema, request.body);
      const { user, token, expiresAt } = await app.auth.register(input, requestContext(request));

      app.sessionCookie.set(reply, token, expiresAt);

      return reply.status(201).send({ user: toUserDto(user) });
    },
  );

  app.post(
    '/login',
    {
      config: { rateLimit: CREDENTIAL_RATE_LIMIT },
      schema: { response: { 200: sessionDtoJsonSchema } },
    },
    async (request, reply) => {
      const input = parseOrThrow(loginSchema, request.body);
      const { user, token, expiresAt } = await app.auth.login(input, requestContext(request));

      app.sessionCookie.set(reply, token, expiresAt);

      return reply.send({ user: toUserDto(user) });
    },
  );

  /**
   * Logout is deliberately tolerant: it always clears the cookie and always returns 204, whether
   * or not a live session was found. Signing out should never fail.
   */
  app.post('/logout', async (request, reply) => {
    await app.auth.logout(app.sessionCookie.read(request));
    app.sessionCookie.clear(reply);

    return reply.status(204).send();
  });

  /** Revoke every session for the account, including this one. */
  app.post(
    '/logout-all',
    {
      preHandler: (request, reply) => app.requireAuth(request, reply),
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { revoked: { type: 'integer' } },
            required: ['revoked'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request, reply) => {
      // requireAuth guarantees a user; the assertion keeps that obvious to a reader.
      const userId = request.user?.id ?? '';
      const revoked = await app.auth.logoutEverywhere(userId);

      app.sessionCookie.clear(reply);

      return reply.send({ revoked });
    },
  );

  app.get(
    '/me',
    {
      preHandler: (request, reply) => app.requireAuth(request, reply),
      schema: { response: { 200: sessionDtoJsonSchema } },
    },
    async (request, reply) => {
      const user = request.user;

      if (user === null) throw new Error('requireAuth did not attach a user');

      return reply.send({ user: toUserDto(user) });
    },
  );
};

export default authRoutes;
