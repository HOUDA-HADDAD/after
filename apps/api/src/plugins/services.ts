import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Env } from '@aftergame/config';
import { createGroupsRepository } from '../modules/groups/groups.repository.js';
import { createGroupsService, type GroupsService } from '../modules/groups/groups.service.js';
import {
  createMembershipsService,
  type MembershipsService,
} from '../modules/memberships/memberships.service.js';
import { createInvitationsRepository } from '../modules/invitations/invitations.repository.js';
import {
  createInvitationsService,
  type InvitationsService,
} from '../modules/invitations/invitations.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    groups: GroupsService;
    memberships: MembershipsService;
    invitations: InvitationsService;
  }
}

/**
 * Composition root for the feature services.
 *
 * Repositories are built once against the root client; anything needing a transaction receives
 * `app.transaction` and rebuilds its repositories against the transaction client inside it. That
 * keeps services free of the Prisma client itself, which is what the
 * `no-prisma-outside-repositories` rule is protecting.
 */
const servicesPlugin: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const groupsRepository = createGroupsRepository(app.prisma);
  const invitationsRepository = createInvitationsRepository(app.prisma);

  app.decorate('groups', createGroupsService({ groups: groupsRepository, env }));

  app.decorate(
    'memberships',
    createMembershipsService({ groups: groupsRepository, transaction: app.transaction }),
  );

  app.decorate(
    'invitations',
    createInvitationsService({
      invitations: invitationsRepository,
      groups: groupsRepository,
      transaction: app.transaction,
      env,
    }),
  );
};

export default fp(servicesPlugin, { name: 'services', dependencies: ['prisma'] });
