import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { Env } from '@aftergame/config';
import { ForbiddenError } from '@aftergame/shared';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * SHA-256 source hashes for every inline `<script>` in a page.
 *
 * `index.html` carries one: the theme bootstrap, which must run before first paint or a dark-mode
 * user gets a white flash. Under `script-src 'self'` a browser refuses it, so the choice is
 * between `'unsafe-inline'` — which gives up most of what a CSP is for — an extra blocking
 * request, and this: hash the exact bytes we ship and allow those.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];

  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1] ?? '';

    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }

  return hashes;
}

export interface CspOptions {
  isProduction: boolean;
  /** Hashes of the inline scripts in the served `index.html`, if this process serves it. */
  scriptHashes?: readonly string[];
}

/**
 * The content security policy, in one place so tests can assert against the real thing.
 *
 * Two directives carry the reasoning:
 *
 * `styleSrcAttr` — React writes a few computed values as inline `style` attributes: a progress
 * bar's width, a card's animation delay. CSP 3 governs those with `style-src-attr`, falling back
 * to `style-src` when absent, so `style-src 'self'` alone silently drops them.
 *
 * `styleSrc` keeps `'unsafe-inline'` in production, and that is a concession rather than an
 * oversight. `sonner`, the toast library, injects its stylesheet as a `<style>` element at
 * runtime; there is no nonce or hash to give it. The exposure is styling, not execution — script
 * stays locked to `'self'` plus the hash of our own bootstrap, which is where XSS actually lives.
 * Recorded in docs/07-security.md under known limitations rather than left to be discovered.
 */
export const cspDirectives = ({ scriptHashes = [] }: CspOptions): Record<string, string[]> => ({
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", ...scriptHashes],
  styleSrc: ["'self'", "'unsafe-inline'"],
  styleSrcAttr: ["'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'", 'ws:', 'wss:'],
  fontSrc: ["'self'", 'data:'],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
  objectSrc: ["'none'"],
  formAction: ["'self'"],
});

/**
 * Security headers, rate limiting, and the CSRF origin check.
 *
 * The app is served from a single origin (docs/01-architecture.md §1), so CORS is off entirely
 * and `SameSite=Lax` plus this origin check is the whole CSRF story — no double-submit token.
 */
/** Hash the inline scripts of the `index.html` this process will serve, if it serves one. */
function servedScriptHashes(env: Env): string[] {
  if (!env.SERVE_STATIC) return [];

  const here = fileURLToPath(new URL('.', import.meta.url));
  const root = isAbsolute(env.WEB_DIST_PATH)
    ? env.WEB_DIST_PATH
    : resolve(here, '..', '..', env.WEB_DIST_PATH);
  const index = resolve(root, 'index.html');

  // A missing file is the static plugin's error to raise, with a much better message than this.
  if (!existsSync(index)) return [];

  return inlineScriptHashes(readFileSync(index, 'utf8'));
}

const securityPlugin: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const isProduction = env.NODE_ENV === 'production';

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: cspDirectives({ isProduction, scriptHashes: servedScriptHashes(env) }),
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
