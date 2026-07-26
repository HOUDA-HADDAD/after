import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/build-test-app.js';

/**
 * Serving the SPA from the API process.
 *
 * Production runs one process on one origin: the API under `/api`, the built client everywhere
 * else (docs/01-architecture.md §1). That arrangement is what makes `__Host-` cookies,
 * `SameSite=Lax` and same-host WebSocket upgrades work without CORS — so a mistake here does not
 * look like a routing bug, it looks like authentication being broken in production only.
 *
 * The fixture is a directory with an index.html and a hashed asset rather than a real Vite build.
 * What is under test is the routing and the fallback, which are ours; that Vite can emit a bundle
 * is Vite's business, and depending on a build step would make this suite ordering-sensitive for
 * no gain.
 */
describe('serving the web client', () => {
  let app: FastifyInstance;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'aftergame-dist-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Aftergame</title>');
    writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log("hi")');

    ({ app } = await buildTestApp({
      env: {
        NODE_ENV: 'production',
        // Production refuses a plain-http origin and the example secret, so both are real here.
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

  it('serves index.html at the root', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Aftergame');
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('serves hashed assets as immutable for a year', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });

    expect(response.statusCode).toBe(200);
    // The filename carries the hash, so the content at this URL can never change.
    expect(response.headers['cache-control']).toContain('immutable');
    expect(response.headers['cache-control']).toContain('max-age=31536000');
  });

  it('falls back to index.html for a client-side route', async () => {
    // A player who refreshes mid-game, or opens a shared link, arrives at a path the server has
    // never heard of. Without this they get a 404 instead of the game.
    const response = await app.inject({ method: 'GET', url: '/groups/abc/games/def' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Aftergame');
  });

  it('does not fall back for an unknown API route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });

    // Answering an API call with a page of HTML turns a clear 404 into a JSON parse error three
    // layers away from the cause.
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not fall back for a socket path', async () => {
    const response = await app.inject({ method: 'GET', url: '/socket.io/unknown' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('does not fall back for a non-GET request', async () => {
    // A POST to a path that does not exist is a client bug, not a deep link.
    const response = await app.inject({ method: 'POST', url: '/not-a-route' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('still serves the API alongside the client', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/version' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'aftergame' });
  });
});

describe('the SERVE_STATIC knob', () => {
  const withClient = async (env: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'aftergame-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Aftergame</title>');

    const { app } = await buildTestApp({ env: { ...env, WEB_DIST_PATH: dir } });
    await app.ready();

    return {
      app,
      cleanup: () => {
        rmSync(dir, { recursive: true, force: true });
      },
    };
  };

  it('serves the client outside production when asked', async () => {
    // What the browser end-to-end suite runs: the real client from the real server, over plain
    // http, because TLS is terminated by the proxy in front rather than by this process.
    const { app, cleanup } = await withClient({ NODE_ENV: 'development', SERVE_STATIC: 'true' });

    try {
      expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    } finally {
      await app.close();
      cleanup();
    }
  });

  it('can be turned off in production, for an SPA behind a CDN', async () => {
    const { app, cleanup } = await withClient({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://aftergame.example',
      SESSION_SECRET: 'a-real-looking-production-secret-value',
      SERVE_STATIC: 'false',
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/' });

      // A 404 problem document, not a 500: with no client to serve, the fallback must not fire.
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect((await app.inject({ method: 'GET', url: '/api/v1/version' })).statusCode).toBe(200);
    } finally {
      await app.close();
      cleanup();
    }
  });
});

describe('a misconfigured static root', () => {
  it('refuses to start rather than serving 404s to every visitor', async () => {
    // Silently starting with no client is the worst outcome: health checks pass, the deploy goes
    // green, and every human sees a blank page.
    await expect(
      buildTestApp({
        env: {
          NODE_ENV: 'production',
          APP_ORIGIN: 'https://aftergame.example',
          SESSION_SECRET: 'a-real-looking-production-secret-value',
          WEB_DIST_PATH: join(tmpdir(), 'aftergame-does-not-exist'),
        },
      }),
    ).rejects.toThrow(/Static root not found/);
  });
});
