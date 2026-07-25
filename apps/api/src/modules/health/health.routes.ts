import type { FastifyPluginAsync } from 'fastify';

/**
 * Liveness and readiness, at the root rather than under /api, because that is where hosting
 * platforms probe (docs/09-deployment.md, Operations).
 *
 * `/healthz` answers "is the process up?" and must never touch a dependency — a slow database
 * should not get the container restarted. `/readyz` answers "can it serve traffic?" and does.
 */
const healthRoutes: FastifyPluginAsync = async (app) => {
  const startedAt = Date.now();

  app.get(
    '/healthz',
    {
      logLevel: 'warn', // platform probes are frequent; don't drown the log
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              uptimeSeconds: { type: 'number' },
            },
            required: ['status', 'uptimeSeconds'],
          },
        },
      },
    },
    async () => ({
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  );

  app.get(
    '/readyz',
    {
      logLevel: 'warn',
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              checks: { type: 'object', additionalProperties: { type: 'boolean' } },
            },
            required: ['status', 'checks'],
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              checks: { type: 'object', additionalProperties: { type: 'boolean' } },
            },
            required: ['status', 'checks'],
          },
        },
      },
    },
    async (_request, reply) => {
      const { ready, checks } = await app.readiness.check();

      return reply.status(ready ? 200 : 503).send({
        status: ready ? 'ready' : 'not-ready',
        checks,
      });
    },
  );
};

export default healthRoutes;
