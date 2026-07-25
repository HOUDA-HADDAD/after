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
import { createPunishmentsRepository } from '../modules/punishments/punishments.repository.js';
import {
  createPunishmentsService,
  type PunishmentsService,
} from '../modules/punishments/punishments.service.js';
import { createSessionsRepository } from '../modules/sessions/sessions.repository.js';
import {
  createSessionsService,
  type SessionsService,
} from '../modules/sessions/sessions.service.js';
import {
  createGameplayService,
  type GameplayService,
} from '../modules/sessions/gameplay.service.js';
import { createEventBus, type EventBus } from '../lib/event-bus.js';

declare module 'fastify' {
  interface FastifyInstance {
    groups: GroupsService;
    memberships: MembershipsService;
    invitations: InvitationsService;
    punishments: PunishmentsService;
    sessions: SessionsService;
    gameplay: GameplayService;
    events: EventBus;
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
  const punishmentsRepository = createPunishmentsRepository(app.prisma);

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

  const sessionsRepository = createSessionsRepository(app.prisma);

  app.decorate(
    'punishments',
    createPunishmentsService({
      punishments: punishmentsRepository,
      groups: groupsRepository,
      transaction: app.transaction,
    }),
  );

  const events = createEventBus((error) => {
    app.log.error({ err: error }, 'event listener failed');
  });

  const sessions = createSessionsService({
    sessions: sessionsRepository,
    groups: groupsRepository,
    transaction: app.transaction,
    events,
    env,
  });

  app.decorate('events', events);
  app.decorate('sessions', sessions);
  app.decorate(
    'gameplay',
    createGameplayService({ sessions: sessionsRepository, lifecycle: sessions, events }),
  );
};

export default fp(servicesPlugin, { name: 'services', dependencies: ['prisma'] });
