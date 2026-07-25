import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Request identity.
 *
 * Every request gets an id that appears in its logs and, on failure, in the `instance` field of
 * the problem document — so a user can quote a code and we can find the exact request without
 * asking them what they wrote. Which matters here, because we never log what they wrote
 * (docs/07-security.md, Logging & privacy).
 */
const requestContextPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
};

export const generateRequestId = (): string => `req_${randomUUID()}`;

export default fp(requestContextPlugin, { name: 'request-context' });
