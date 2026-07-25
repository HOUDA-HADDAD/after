import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyPluginAsync } from 'fastify';
import type { Env } from '@aftergame/config';

/**
 * Serve the built SPA from the API process in production.
 *
 * One origin means no CORS, `__Host-` cookies with `SameSite=Lax`, WebSocket upgrades on the same
 * host, and a single deploy unit that fits every free tier (docs/01-architecture.md §1,
 * docs/09-deployment.md). In development Vite serves the client and proxies here instead.
 */
const staticPlugin: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  if (env.NODE_ENV !== 'production') return;

  const here = fileURLToPath(new URL('.', import.meta.url));
  const root = isAbsolute(env.WEB_DIST_PATH)
    ? env.WEB_DIST_PATH
    : resolve(here, '..', '..', env.WEB_DIST_PATH);

  if (!existsSync(root)) {
    app.log.error({ root }, 'WEB_DIST_PATH does not exist — build the web app before starting');
    throw new Error(`Static root not found: ${root}. Run \`pnpm build\` first.`);
  }

  await app.register(fastifyStatic, {
    root,
    // Hashed asset filenames are safe to cache hard; index.html is handled by the SPA fallback.
    maxAge: '1y',
    immutable: true,
    index: ['index.html'],
  });

  app.log.info({ root }, 'serving web client');
};

export default fp(staticPlugin, { name: 'static' });
