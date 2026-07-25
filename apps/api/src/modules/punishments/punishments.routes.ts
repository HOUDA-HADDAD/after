import { z } from 'zod';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parseOrThrow } from '../../lib/validate.js';
import { memberJsonSchema } from '../groups/groups.mapper.js';
import { punishmentHistoryJsonSchema } from './punishments.mapper.js';

interface GroupParams {
  groupId: string;
}

interface MemberParams extends GroupParams {
  userId: string;
}

const punishSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

const userId = (request: FastifyRequest): string => {
  if (request.user === null) throw new Error('route reached without authentication');
  return request.user.id;
};

/**
 * Punishment routes.
 *
 * Registered inside the group routes, so they inherit the `/groups` prefix and the same
 * membership-scoped 404 behaviour.
 */
const punishmentRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: MemberParams }>(
    '/:groupId/members/:userId/punish',
    {
      config: { policy: 'punishment:punish' },
      schema: { response: { 200: memberJsonSchema } },
    },
    async (request) => {
      const { reason } = parseOrThrow(punishSchema, request.body ?? {});

      return app.punishments.punish(
        request.params.groupId,
        userId(request),
        request.params.userId,
        reason,
      );
    },
  );

  app.post<{ Params: MemberParams }>(
    '/:groupId/members/:userId/forgive',
    {
      config: { policy: 'punishment:forgive' },
      schema: { response: { 200: memberJsonSchema } },
    },
    async (request) =>
      app.punishments.forgive(request.params.groupId, userId(request), request.params.userId),
  );

  app.get<{ Params: GroupParams }>(
    '/:groupId/punishments',
    {
      config: { policy: 'punishment:list' },
      schema: { response: { 200: punishmentHistoryJsonSchema } },
    },
    async (request) => ({
      events: await app.punishments.history(request.params.groupId, userId(request)),
    }),
  );
};

export default punishmentRoutes;
