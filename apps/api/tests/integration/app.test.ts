import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/build-test-app.js';

describe('application skeleton', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('health endpoints', () => {
    it('reports liveness without touching dependencies', async () => {
      const response = await app.inject({ method: 'GET', url: '/healthz' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok' });
    });

    it('reports readiness from the probe registry', async () => {
      const response = await app.inject({ method: 'GET', url: '/readyz' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ready', checks: {} });
    });

    it('reports not-ready when a probe fails', async () => {
      const { app: failing } = await buildTestApp({
        routes: (instance) => {
          instance.readiness.add('database', async () => false);
        },
      });
      await failing.ready();

      const response = await failing.inject({ method: 'GET', url: '/readyz' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'not-ready', checks: { database: false } });

      await failing.close();
    });

    it('treats a throwing probe as not ready rather than crashing', async () => {
      const { app: failing } = await buildTestApp({
        routes: (instance) => {
          instance.readiness.add('database', async () => {
            throw new Error('connection refused');
          });
        },
      });
      await failing.ready();

      const response = await failing.inject({ method: 'GET', url: '/readyz' });

      expect(response.statusCode).toBe(503);
      await failing.close();
    });
  });

  describe('error handling', () => {
    it('returns a problem document for unknown API routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
        type: 'https://aftergame.app/errors/not-found',
      });
    });

    it('includes the request id so a user can quote it', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });

      expect(response.json().instance).toMatch(/^req_/);
      expect(response.headers['x-request-id']).toMatch(/^req_/);
    });
  });

  describe('security', () => {
    it('sets the documented security headers', async () => {
      const response = await app.inject({ method: 'GET', url: '/healthz' });

      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['permissions-policy']).toContain('microphone=(self)');
    });

    describe('CSRF origin check', () => {
      let csrfApp: FastifyInstance;

      beforeAll(async () => {
        ({ app: csrfApp } = await buildTestApp({
          routes: (instance) => {
            instance.post('/api/v1/__csrf-probe', async () => ({ ok: true }));
          },
        }));
        await csrfApp.ready();
      });

      afterAll(async () => {
        await csrfApp.close();
      });

      const probe = (headers: Record<string, string> = {}) =>
        csrfApp.inject({ method: 'POST', url: '/api/v1/__csrf-probe', headers, payload: {} });

      it('rejects a mutating request from a foreign origin', async () => {
        const response = await probe({ origin: 'https://evil.example.com' });

        expect(response.statusCode).toBe(403);
        expect(response.json().code).toBe('FORBIDDEN');
      });

      it('accepts a mutating request from our own origin', async () => {
        const response = await probe({ origin: 'http://localhost:5173' });

        expect(response.statusCode).toBe(200);
      });

      it('accepts a mutating request with no Origin, which cannot be a browser CSRF', async () => {
        const response = await probe();

        expect(response.statusCode).toBe(200);
      });
    });
  });

  it('exposes a version endpoint under /api/v1', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/version' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'aftergame' });
  });
});
