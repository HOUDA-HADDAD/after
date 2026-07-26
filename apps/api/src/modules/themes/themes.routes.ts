import { groupThemeSchema } from '@aftergame/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parseOrThrow } from '../../lib/validate.js';

const themeJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    writePrompt: { type: 'string' },
    writePlaceholder: { type: 'string' },
    answerPrompt: { type: 'string' },
    icon: { type: 'string' },
    supportsComments: { type: 'boolean' },
    supportsAuthorGuess: { type: 'boolean' },
    isSystem: { type: 'boolean' },
    isCustom: { type: 'boolean' },
  },
  required: [
    'id',
    'slug',
    'name',
    'supportsComments',
    'supportsAuthorGuess',
    'isSystem',
    'isCustom',
  ],
  additionalProperties: false,
} as const;

const groupThemeJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    writePrompt: { type: 'string' },
    writePlaceholder: { type: 'string' },
    answerPrompt: { type: 'string' },
    icon: { type: 'string' },
    supportsComments: { type: 'boolean' },
    supportsAuthorGuess: { type: 'boolean' },
    usedByGames: { type: 'integer' },
    createdAt: { type: 'string' },
  },
  required: ['id', 'slug', 'name', 'usedByGames', 'createdAt'],
  additionalProperties: false,
} as const;

interface GroupParams {
  groupId: string;
}

interface ThemeParams extends GroupParams {
  themeId: string;
}

const userId = (request: FastifyRequest): string => {
  if (request.user === null) throw new Error('route reached without authentication');
  return request.user.id;
};

/**
 * Themes, scoped to a group.
 *
 * There is deliberately no installation-wide theme list any more. Once a group can write its own
 * (D19), a global endpoint would hand every group's prompts to every other group — and "remember
 * to filter it at the call site" is exactly the kind of rule that holds right up until somebody
 * adds a second call site. Scoping the route makes the leak unrepresentable.
 */
export const groupThemeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: GroupParams }>(
    '/:groupId/themes',
    {
      config: { policy: 'theme:read' },
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { themes: { type: 'array', items: themeJsonSchema } },
            required: ['themes'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request) => ({
      themes: await app.themes.listPlayable(request.params.groupId, userId(request)),
    }),
  );

  app.get<{ Params: GroupParams }>(
    '/:groupId/themes/custom',
    {
      config: { policy: 'theme:read' },
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { themes: { type: 'array', items: groupThemeJsonSchema } },
            required: ['themes'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request) => ({
      themes: await app.themes.listOwn(request.params.groupId, userId(request)),
    }),
  );

  app.post<{ Params: GroupParams }>(
    '/:groupId/themes',
    { config: { policy: 'theme:manage' }, schema: { response: { 201: groupThemeJsonSchema } } },
    async (request, reply) => {
      const input = parseOrThrow(groupThemeSchema, request.body);

      return reply
        .status(201)
        .send(await app.themes.create(request.params.groupId, userId(request), input));
    },
  );

  app.put<{ Params: ThemeParams }>(
    '/:groupId/themes/:themeId',
    { config: { policy: 'theme:manage' }, schema: { response: { 200: groupThemeJsonSchema } } },
    async (request) => {
      const input = parseOrThrow(groupThemeSchema, request.body);

      return app.themes.update(
        request.params.groupId,
        userId(request),
        request.params.themeId,
        input,
      );
    },
  );

  app.delete<{ Params: ThemeParams }>(
    '/:groupId/themes/:themeId',
    { config: { policy: 'theme:manage' } },
    async (request, reply) => {
      await app.themes.remove(request.params.groupId, userId(request), request.params.themeId);

      return reply.status(204).send();
    },
  );
};

export default groupThemeRoutes;
