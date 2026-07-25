import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { Env } from '@aftergame/config';
import { ForbiddenError } from '@aftergame/shared';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Security headers, rate limiting, and the CSRF origin check.
 *
 * The app is served from a single origin (docs/01-architecture.md §1), so CORS is off entirely
 * and `SameSite=Lax` plus this origin check is the whole CSRF story — no double-submit token.
 */
const securityPlugin: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const isProduction = env.NODE_ENV === 'production';

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Tailwind ships a stylesheet; 'unsafe-inline' is needed only for Vite's dev overlay.
        styleSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        formAction: ["'self'"],
      },
    },
    // Dictation uses the browser's Web Speech API, so the microphone is allowed — for us only.
    permittedCrossDomainPolicies: false,
    hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=(self)');
    return payload;
  });

  if (env.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      // Authenticated users get their own budget; everyone else shares one per IP.
      keyGenerator: (request) => request.ip,
    });
  }

  /**
   * CSRF: reject a mutating request whose Origin is not ours.
   *
   * A missing Origin is allowed on purpose. Browsers attach Origin to every mutating request, so
   * "no Origin" means "not a browser" — and a non-browser client has no ambient cookie to be
   * tricked into sending, which is the entire premise of CSRF.
   */
  app.addHook('onRequest', async (request) => {
    if (!MUTATING_METHODS.has(request.method)) return;

    const origin = request.headers.origin;
    if (origin === undefined) return;
    if (origin === env.APP_ORIGIN) return;

    request.log.warn({ origin, method: request.method }, 'rejected cross-origin mutation');
    throw new ForbiddenError(undefined, 'Cross-origin requests are not accepted.');
  });
};

export default fp(securityPlugin, { name: 'security' });
