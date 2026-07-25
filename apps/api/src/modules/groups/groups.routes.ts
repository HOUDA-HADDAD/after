import {
  changeRoleSchema,
  createGroupSchema,
  createInvitationSchema,
  joinByCodeSchema,
  renameGroupSchema,
} from '@aftergame/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parseOrThrow } from '../../lib/validate.js';
import {
  groupDetailJsonSchema,
  groupListJsonSchema,
  groupSummaryJsonSchema,
  memberListJsonSchema,
} from './groups.mapper.js';
import punishmentRoutes from '../punishments/punishments.routes.js';

interface GroupParams {
  groupId: string;
}

interface MemberParams extends GroupParams {
  userId: string;
}

interface InvitationParams extends GroupParams {
  invitationId: string;
}

const invitationJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    code: { type: 'string' },
    expiresAt: { type: ['string', 'null'] },
    maxUses: { type: ['integer', 'null'] },
    useCount: { type: 'integer' },
    createdAt: { type: 'string' },
  },
  required: ['id', 'code', 'expiresAt', 'maxUses', 'useCount', 'createdAt'],
  additionalProperties: false,
} as const;

/** requireAuth has already run for every route here, so the user is present. */
const userId = (request: FastifyRequest): string => {
  if (request.user === null) throw new Error('route reached without authentication');
  return request.user.id;
};

/**
 * Group, membership and invitation routes.
 *
 * Every route declares `config.policy`. That is not documentation — the route-policy plugin
 * refuses to boot without it, and anything other than `public` gets authentication attached
 * automatically.
 */
const groupRoutes: FastifyPluginAsync = async (app) => {
  /* ---- Groups ------------------------------------------------------------------------- */

  app.get(
    '/',
    {
      config: { policy: 'authenticated' },
      schema: { response: { 200: groupListJsonSchema } },
    },
    async (request) => ({ groups: await app.groups.listForUser(userId(request)) }),
  );

  app.post(
    '/',
    {
      config: { policy: 'authenticated' },
      schema: { response: { 201: groupSummaryJsonSchema } },
    },
    async (request, reply) => {
      const { name } = parseOrThrow(createGroupSchema, request.body);

      return reply.status(201).send(await app.groups.create(userId(request), name));
    },
  );

  app.get<{ Params: GroupParams }>(
    '/:groupId',
    {
      config: { policy: 'group:read' },
      schema: { response: { 200: groupDetailJsonSchema } },
    },
    async (request) => app.groups.detail(request.params.groupId, userId(request)),
  );

  app.patch<{ Params: GroupParams }>(
    '/:groupId',
    {
      config: { policy: 'group:rename' },
      schema: { response: { 200: groupSummaryJsonSchema } },
    },
    async (request) => {
      const { name } = parseOrThrow(renameGroupSchema, request.body);

      return app.groups.rename(request.params.groupId, userId(request), name);
    },
  );

  app.delete<{ Params: GroupParams }>(
    '/:groupId',
    { config: { policy: 'group:delete' } },
    async (request, reply) => {
      await app.groups.remove(request.params.groupId, userId(request));

      return reply.status(204).send();
    },
  );

  /* ---- Members ------------------------------------------------------------------------ */

  app.get<{ Params: GroupParams }>(
    '/:groupId/members',
    {
      config: { policy: 'member:list' },
      schema: { response: { 200: memberListJsonSchema } },
    },
    async (request) => ({
      members: await app.memberships.list(request.params.groupId, userId(request)),
    }),
  );

  app.patch<{ Params: MemberParams }>(
    '/:groupId/members/:userId',
    {
      // Promote and demote are the same endpoint; the policy engine distinguishes them by the
      // requested role, so both are declared here as the stricter of the two.
      config: { policy: 'member:promote' },
      schema: { response: { 200: { type: 'object', additionalProperties: true } } },
    },
    async (request) => {
      const { role } = parseOrThrow(changeRoleSchema, request.body);

      return app.memberships.changeRole(
        request.params.groupId,
        userId(request),
        request.params.userId,
        role,
      );
    },
  );

  app.delete<{ Params: MemberParams }>(
    '/:groupId/members/:userId',
    { config: { policy: 'member:remove' } },
    async (request, reply) => {
      await app.memberships.remove(request.params.groupId, userId(request), request.params.userId);

      return reply.status(204).send();
    },
  );

  app.post<{ Params: GroupParams }>(
    '/:groupId/leave',
    { config: { policy: 'member:leave' } },
    async (request, reply) => {
      await app.memberships.leave(request.params.groupId, userId(request));

      return reply.status(204).send();
    },
  );

  app.post<{ Params: MemberParams }>(
    '/:groupId/transfer-ownership/:userId',
    {
      config: { policy: 'ownership:transfer' },
      schema: { response: { 200: memberListJsonSchema } },
    },
    async (request) => ({
      members: await app.memberships.transferOwnership(
        request.params.groupId,
        userId(request),
        request.params.userId,
      ),
    }),
  );

  /* ---- Invitations -------------------------------------------------------------------- */

  app.get<{ Params: GroupParams }>(
    '/:groupId/invitations',
    {
      config: { policy: 'invitation:list' },
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { invitations: { type: 'array', items: invitationJsonSchema } },
            required: ['invitations'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request) => ({
      invitations: await app.invitations.list(request.params.groupId, userId(request)),
    }),
  );

  app.post<{ Params: GroupParams }>(
    '/:groupId/invitations',
    {
      config: { policy: 'invitation:create' },
      schema: { response: { 201: invitationJsonSchema } },
    },
    async (request, reply) => {
      const options = parseOrThrow(createInvitationSchema, request.body ?? {});

      return reply
        .status(201)
        .send(await app.invitations.create(request.params.groupId, userId(request), options));
    },
  );

  app.delete<{ Params: InvitationParams }>(
    '/:groupId/invitations/:invitationId',
    { config: { policy: 'invitation:revoke' } },
    async (request, reply) => {
      await app.invitations.revoke(
        request.params.groupId,
        userId(request),
        request.params.invitationId,
      );

      return reply.status(204).send();
    },
  );

  /* ---- Punishments -------------------------------------------------------------------- */

  await app.register(punishmentRoutes);
};

/**
 * Redeeming a code is not a group route — the caller is not a member yet, so it cannot be
 * scoped by membership and lives outside `/groups/:groupId`.
 */
export const joinRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/join',
    {
      config: {
        policy: 'authenticated',
        // A room code is the one guessable secret in the app, and this is the only endpoint that
        // tests one. It gets the tightest budget in the system (docs/07-security.md).
        rateLimit: { max: 10, timeWindow: '1 hour' },
      },
      schema: { response: { 200: groupSummaryJsonSchema } },
    },
    async (request) => {
      const { code } = parseOrThrow(joinByCodeSchema, request.body);

      return app.invitations.redeem(code, userId(request));
    },
  );
};

export default groupRoutes;
