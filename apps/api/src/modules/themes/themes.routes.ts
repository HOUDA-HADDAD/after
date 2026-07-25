import type { FastifyPluginAsync } from 'fastify';
import { createThemesRepository } from './themes.repository.js';

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
  },
  required: ['id', 'slug', 'name', 'supportsComments', 'supportsAuthorGuess'],
  additionalProperties: false,
} as const;

/**
 * The theme picker's data.
 *
 * Read-only and identical for everyone, but still behind authentication — there is no reason for
 * an anonymous caller to enumerate anything about this app.
 */
const themeRoutes: FastifyPluginAsync = async (app) => {
  const themes = createThemesRepository(app.prisma);

  app.get(
    '/',
    {
      config: { policy: 'authenticated' },
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
    async () => ({ themes: await themes.list() }),
  );
};

export default themeRoutes;
