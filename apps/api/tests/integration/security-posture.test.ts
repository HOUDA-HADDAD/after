import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE_NAME } from '@aftergame/shared';
import { inlineScriptHashes } from '../../src/plugins/security.js';
import { buildTestApp } from '../helpers/build-test-app.js';
import { credentials } from '../helpers/auth.js';

/** Shaped like the real `index.html`: one inline bootstrap that must run before first paint. */
const INDEX_HTML = `<!doctype html><html><head><title>Aftergame</title>
<script>document.documentElement.classList.add('dark');</script>
</head><body><div id="root"></div>
<script type="module" src="/assets/index-abc123.js"></script>
</body></html>`;

/**
 * The security posture a deployment actually ships with.
 *
 * Everything here is production-only behaviour — HSTS, the strict CSP, the `__Host-` cookie — and
 * every one of it was previously unasserted, because the rest of the suite runs in test mode. The
 * browser suite cannot cover it either: `__Host-` and `Secure` need TLS, which is terminated by
 * the proxy in front rather than by this process (docs/09-deployment.md).
 *
 * So it is checked here, at the only layer that can see it.
 */
describe('production security headers', () => {
  let app: FastifyInstance;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'aftergame-dist-'));
    writeFileSync(join(root, 'index.html'), INDEX_HTML);

    ({ app } = await buildTestApp({
      env: {
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://aftergame.example',
        SESSION_SECRET: 'a-real-looking-production-secret-value',
        WEB_DIST_PATH: root,
      },
    }));

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('sends HSTS for a year, including subdomains', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/version' });

    // Off in development, where there is no TLS to insist on — and therefore never exercised by
    // any other test in this repository.
    expect(response.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('locks script down to itself and the hash of the one inline script we ship', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    const csp = String(response.headers['content-security-policy']);

    // The theme bootstrap must run before first paint, so it is inline — and allowed by the hash
    // of its exact bytes rather than by `'unsafe-inline'`, which would open the door it exists to
    // keep shut. Script is the directive XSS cares about.
    const [hash] = inlineScriptHashes(INDEX_HTML);

    // The hash is of the served file's bytes, not a constant repeated here — change the bootstrap
    // and the header changes with it.
    expect(hash).toBeDefined();
    expect(csp).toContain(`script-src 'self' ${String(hash)}`);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);

    // The module script has a `src`, so it is served from 'self' and needs no hash of its own.
    expect(inlineScriptHashes(INDEX_HTML)).toHaveLength(1);

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('permits inline styles, deliberately and narrowly', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    const csp = String(response.headers['content-security-policy']);

    // Two separate reasons, both recorded in docs/07-security.md: `sonner` injects its stylesheet
    // as a <style> element at runtime with no nonce to give it, and React writes computed values
    // as inline `style` attributes, which CSP 3 governs with `style-src-attr`. The exposure is
    // styling rather than execution.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it('keeps the other headers on in production too', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/version' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('microphone=(self)');
    expect(response.headers['permissions-policy']).toContain('camera=()');
  });

  it('issues a __Host- session cookie that a browser will only return over TLS', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'https://aftergame.example' },
      payload: credentials(),
    });

    expect(response.statusCode).toBe(201);

    const raw = response.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw.join('\n') : String(raw);

    // The `__Host-` prefix is only honoured with all three of Secure, Path=/ and no Domain — the
    // browser enforces it, so getting any of them wrong silently downgrades the cookie.
    expect(header).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).toMatch(/;\s*HttpOnly/i);
    expect(header).toMatch(/;\s*SameSite=Lax/i);
    expect(header).toMatch(/;\s*Path=\//i);
    expect(header).not.toMatch(/;\s*Domain=/i);
  });

  it('refuses a mutation from another origin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'someone@example.com', password: 'a decently long passphrase' },
    });

    // SameSite=Lax plus this check is the whole CSRF story on a single origin.
    expect(response.statusCode).toBe(403);
  });
});

describe('rate limiting', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Every other suite runs with the limiter off so that assertions are about behaviour rather
    // than about how fast the tests happen to run. This one exists to prove it works at all.
    ({ app } = await buildTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('turns a burst into 429s rather than serving all of it', async () => {
    const responses = await Promise.all(
      Array.from({ length: 320 }, () => app.inject({ method: 'GET', url: '/api/v1/version' })),
    );

    const limited = responses.filter((response) => response.statusCode === 429);

    expect(limited.length).toBeGreaterThan(0);

    // A limiter that answers with an opaque body is a support ticket; ours says what happened.
    const first = limited[0];
    expect(first?.headers['content-type']).toContain('application/problem+json');
    expect(first?.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });
});
