import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { testPrisma, resetDatabase, disconnectTestPrisma } from '../helpers/prisma.js';
import { buildTestApp } from '../helpers/build-test-app.js';
import {
  asUser,
  credentials,
  registerUser,
  sessionCookieFrom,
  TEST_COOKIE_NAME,
  type InjectResponse,
} from '../helpers/auth.js';
import { hashSessionToken } from '../../src/lib/tokens.js';

describe('authentication', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = testPrisma();
    ({ app } = await buildTestApp());
    await app.ready();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  const post = (url: string, payload: object): Promise<InjectResponse> =>
    app.inject({ method: 'POST', url: `/api/v1/auth/${url}`, payload });

  describe('registration', () => {
    it('creates an account and signs the user in', async () => {
      const input = credentials();
      const response = await post('register', input);

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        user: {
          id: expect.any(String),
          username: input.username,
          email: input.email,
          createdAt: expect.any(String),
        },
      });
      expect(sessionCookieFrom(response)).toBeTruthy();
    });

    it('never returns the password hash', async () => {
      const response = await post('register', credentials());

      // The mapper lists fields explicitly and the response schema drops the rest; this asserts
      // on the serialized bytes, which is where a leak would actually happen.
      expect(response.body).not.toMatch(/passwordHash|argon2|\$argon/i);
    });

    it('stores an argon2id hash, never the password', async () => {
      const input = credentials();
      await post('register', input);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: input.email } });

      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(input.password);
    });

    it('rejects a duplicate email, including one differing only in case', async () => {
      const input = credentials({ email: 'Sarah@Example.com' });
      await post('register', input);

      const response = await post('register', {
        ...credentials(),
        email: 'sarah@example.com',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('EMAIL_TAKEN');
    });

    it('rejects a duplicate username, including one differing only in case', async () => {
      const input = credentials({ username: 'Sarah' });
      await post('register', input);

      const response = await post('register', { ...credentials(), username: 'sarah' });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('USERNAME_TAKEN');
    });

    it('rejects invalid input with field-level messages', async () => {
      const response = await post('register', { username: 'a', email: 'nope', password: 'short' });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(body.errors as object).sort()).toEqual(['email', 'password', 'username']);
    });

    it('creates no user when validation fails', async () => {
      await post('register', { username: 'a', email: 'nope', password: 'short' });

      expect(await prisma.user.count()).toBe(0);
    });
  });

  describe('login', () => {
    it('signs in with correct credentials', async () => {
      const { credentials: input } = await registerUser(app);

      const response = await post('login', { email: input.email, password: input.password });

      expect(response.statusCode).toBe(200);
      expect(response.json().user.email).toBe(input.email);
      expect(sessionCookieFrom(response)).toBeTruthy();
    });

    it('signs in regardless of email case', async () => {
      const { credentials: input } = await registerUser(app, { email: 'Sarah@Example.com' });

      const response = await post('login', {
        email: 'sarah@EXAMPLE.com',
        password: input.password,
      });

      expect(response.statusCode).toBe(200);
    });

    it('issues a distinct session per sign-in, so devices are independent', async () => {
      const { credentials: input, token: first } = await registerUser(app);

      const response = await post('login', { email: input.email, password: input.password });
      const second = sessionCookieFrom(response);

      expect(second).not.toBe(first);
      expect(await prisma.authSession.count()).toBe(2);
    });

    it('returns the same error for a wrong password and an unknown account', async () => {
      const { credentials: input } = await registerUser(app);

      const wrongPassword = await post('login', {
        email: input.email,
        password: 'definitely not the password',
      });
      const unknownEmail = await post('login', {
        email: 'nobody@example.com',
        password: input.password,
      });

      // Identical status, code and title: the response is not an oracle for who has an account.
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(unknownEmail.json().code).toBe(wrongPassword.json().code);
      expect(unknownEmail.json().title).toBe(wrongPassword.json().title);
    });

    it('sets no cookie when credentials are wrong', async () => {
      const response = await post('login', { email: 'nobody@example.com', password: 'whatever' });

      expect(sessionCookieFrom(response)).toBeUndefined();
      expect(await prisma.authSession.count()).toBe(0);
    });

    it('takes comparable time for an unknown account and a wrong password', async () => {
      // The identical error message is worthless if the unknown-email path returns in
      // microseconds. This is the assertion that the dummy verification is actually happening.
      const { credentials: input } = await registerUser(app);

      const time = async (email: string): Promise<number> => {
        const started = process.hrtime.bigint();
        await post('login', { email, password: 'definitely not the password' });
        return Number(process.hrtime.bigint() - started) / 1e6;
      };

      // Warm both paths so JIT and the cached dummy hash do not skew the first measurement.
      await time(input.email);
      await time('nobody@example.com');

      const samples = 7;
      const known: number[] = [];
      const unknown: number[] = [];

      for (let index = 0; index < samples; index += 1) {
        known.push(await time(input.email));
        unknown.push(await time(`nobody${String(index)}@example.com`));
      }

      const median = (values: number[]): number =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

      const ratio = median(unknown) / median(known);

      // Generous bounds — this is a smoke test for a missing dummy hash (which would show up as
      // a ratio near zero), not a defence against a laboratory timing attack.
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(2.5);
    });

    it('limits attempts per account', async () => {
      const { credentials: input } = await registerUser(app);

      const attempt = () => post('login', { email: input.email, password: 'wrong' });

      for (let index = 0; index < 10; index += 1) {
        expect((await attempt()).statusCode).toBe(401);
      }

      // The eleventh is refused outright — this is the limit an attacker spreading guesses
      // across many IP addresses runs into.
      expect((await attempt()).statusCode).toBe(429);
    });

    it('clears the attempt count after a successful sign-in', async () => {
      const { credentials: input } = await registerUser(app);

      await post('login', { email: input.email, password: 'wrong' });
      await post('login', { email: input.email, password: 'wrong' });
      expect(
        (await post('login', { email: input.email, password: input.password })).statusCode,
      ).toBe(200);

      for (let index = 0; index < 10; index += 1) {
        expect((await post('login', { email: input.email, password: 'wrong' })).statusCode).toBe(
          401,
        );
      }
    });
  });

  describe('session cookie', () => {
    it('is httpOnly, SameSite=Lax and scoped to the whole site', async () => {
      const response = await post('register', credentials());
      const header = response.headers['set-cookie'];
      const cookie = Array.isArray(header) ? header.join(';') : String(header);

      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
    });

    it('omits Secure and the __Host- prefix outside production, where browsers reject them', async () => {
      const response = await post('register', credentials());
      const header = String(response.headers['set-cookie']);

      expect(header).toContain(TEST_COOKIE_NAME);
      expect(header).not.toMatch(/Secure/i);
    });

    it('uses the __Host- prefix with Secure in production', async () => {
      const { app: production } = await buildTestApp({
        env: { NODE_ENV: 'production', APP_ORIGIN: 'https://aftergame.example.com' },
      });
      await production.ready();

      const response = await production.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: credentials(),
      });
      const header = String(response.headers['set-cookie']);

      // Browsers accept __Host- only with Secure, Path=/ and no Domain — which is what makes a
      // compromised sibling subdomain unable to write our session cookie.
      expect(header).toContain('__Host-aftergame_session');
      expect(header).toMatch(/Secure/i);
      expect(header).not.toMatch(/Domain=/i);

      await production.close();
    });
  });

  describe('token storage', () => {
    it('stores only the hash of the token', async () => {
      const { token } = await registerUser(app);
      const session = await prisma.authSession.findFirstOrThrow();

      // Prisma 6 hands back a Uint8Array for `Bytes`, not a Node Buffer.
      const stored = Buffer.from(session.tokenHash);

      expect(stored.equals(hashSessionToken(token))).toBe(true);
      // The raw token appears nowhere in the row.
      expect(JSON.stringify(session)).not.toContain(token);
    });

    it('cannot be replayed from a stolen database dump', async () => {
      // Everything an attacker with the database has: the stored hash, in every encoding they
      // might try as a cookie. None of them authenticate, because the server hashes what it
      // receives before looking it up.
      const { token } = await registerUser(app);
      const session = await prisma.authSession.findFirstOrThrow();
      const stored = Buffer.from(session.tokenHash);

      for (const stolen of [
        stored.toString('base64url'),
        stored.toString('base64'),
        stored.toString('hex'),
      ]) {
        const response = await app.inject(
          asUser(stolen, { method: 'GET', url: '/api/v1/auth/me' }),
        );
        expect(response.statusCode).toBe(401);
      }

      // The genuine token still works, so the test is proving the dump is useless rather than
      // that authentication is broken.
      expect(
        (await app.inject(asUser(token, { method: 'GET', url: '/api/v1/auth/me' }))).statusCode,
      ).toBe(200);
    });

    it('records a hashed IP, never a raw one', async () => {
      await registerUser(app);
      const session = await prisma.authSession.findFirstOrThrow();

      expect(session.ipHash).toMatch(/^[a-f0-9]{32}$/);
      expect(session.ipHash).not.toContain('127.0.0.1');
    });
  });

  describe('protected routes', () => {
    it('returns the signed-in user from /me', async () => {
      const { token, credentials: input } = await registerUser(app);

      const response = await app.inject(asUser(token, { method: 'GET', url: '/api/v1/auth/me' }));

      expect(response.statusCode).toBe(200);
      expect(response.json().user.username).toBe(input.username);
    });

    it.each([
      ['no cookie', undefined],
      ['an empty cookie', ''],
      ['a malformed cookie', 'not-a-real-token'],
      ['a well-formed but unknown token', 'A'.repeat(43)],
    ])('rejects a request with %s', async (_label, token) => {
      const options =
        token === undefined
          ? { method: 'GET' as const, url: '/api/v1/auth/me' }
          : asUser(token, { method: 'GET' as const, url: '/api/v1/auth/me' });

      const response = await app.inject(options);

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('UNAUTHENTICATED');
    });

    it('clears a stale cookie so the browser stops sending it', async () => {
      const response = await app.inject(
        asUser('A'.repeat(43), { method: 'GET', url: '/api/v1/auth/me' }),
      );

      expect(String(response.headers['set-cookie'])).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    });
  });

  describe('logout', () => {
    it('destroys the session server-side and clears the cookie', async () => {
      const { token } = await registerUser(app);

      const response = await app.inject(
        asUser(token, { method: 'POST', url: '/api/v1/auth/logout' }),
      );

      expect(response.statusCode).toBe(204);
      expect(String(response.headers['set-cookie'])).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
      // Deleting the row is what makes the token dead even if the cookie is replayed.
      expect(await prisma.authSession.count()).toBe(0);
    });

    it('makes the old token unusable', async () => {
      const { token } = await registerUser(app);
      await app.inject(asUser(token, { method: 'POST', url: '/api/v1/auth/logout' }));

      const response = await app.inject(asUser(token, { method: 'GET', url: '/api/v1/auth/me' }));

      expect(response.statusCode).toBe(401);
    });

    it('succeeds even when nobody is signed in', async () => {
      // Signing out should never fail; a user who has already lost their session still deserves
      // a clean result rather than an error page.
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });

      expect(response.statusCode).toBe(204);
    });

    it('leaves other sessions of the same user alone', async () => {
      const { credentials: input, token: first } = await registerUser(app);
      const second = sessionCookieFrom(
        await post('login', { email: input.email, password: input.password }),
      );

      await app.inject(asUser(first, { method: 'POST', url: '/api/v1/auth/logout' }));

      expect(
        (await app.inject(asUser(second ?? '', { method: 'GET', url: '/api/v1/auth/me' })))
          .statusCode,
      ).toBe(200);
    });
  });

  describe('sign out everywhere', () => {
    it('revokes every session for the account', async () => {
      const { credentials: input, token: first } = await registerUser(app);
      const second = sessionCookieFrom(
        await post('login', { email: input.email, password: input.password }),
      );

      const response = await app.inject(
        asUser(first, { method: 'POST', url: '/api/v1/auth/logout-all' }),
      );

      expect(response.statusCode).toBe(200);
      expect(response.json().revoked).toBe(2);
      expect(
        (await app.inject(asUser(second ?? '', { method: 'GET', url: '/api/v1/auth/me' })))
          .statusCode,
      ).toBe(401);
    });

    it('does not touch other accounts', async () => {
      const { token: mine } = await registerUser(app);
      const { token: theirs } = await registerUser(app);

      await app.inject(asUser(mine, { method: 'POST', url: '/api/v1/auth/logout-all' }));

      expect(
        (await app.inject(asUser(theirs, { method: 'GET', url: '/api/v1/auth/me' }))).statusCode,
      ).toBe(200);
    });

    it('requires authentication', async () => {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout-all' });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('expiry', () => {
    it('rejects an expired session and deletes it on sight', async () => {
      const { token } = await registerUser(app);

      await prisma.authSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

      const response = await app.inject(asUser(token, { method: 'GET', url: '/api/v1/auth/me' }));

      expect(response.statusCode).toBe(401);
      expect(await prisma.authSession.count()).toBe(0);
    });

    it('extends a session that has not been used for an hour', async () => {
      const { token } = await registerUser(app);
      const before = await prisma.authSession.findFirstOrThrow();

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await prisma.authSession.updateMany({ data: { lastUsedAt: twoHoursAgo } });

      await app.inject(asUser(token, { method: 'GET', url: '/api/v1/auth/me' }));

      const after = await prisma.authSession.findFirstOrThrow();
      expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
      expect(after.lastUsedAt.getTime()).toBeGreaterThan(twoHoursAgo.getTime());
    });

    it('does not write on every request', async () => {
      // Sliding expiry without a refresh interval would mean a database write per request, for a
      // value that changes meaningfully once a month.
      const { token } = await registerUser(app);
      const before = await prisma.authSession.findFirstOrThrow();

      await app.inject(asUser(token, { method: 'GET', url: '/api/v1/auth/me' }));
      await app.inject(asUser(token, { method: 'GET', url: '/api/v1/auth/me' }));

      const after = await prisma.authSession.findFirstOrThrow();
      expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    });
  });

  describe('full lifecycle', () => {
    it('registers, signs out, signs back in, and reaches a protected route', async () => {
      const input = credentials();

      const registered = await post('register', input);
      expect(registered.statusCode).toBe(201);
      const firstToken = sessionCookieFrom(registered) ?? '';

      expect(
        (await app.inject(asUser(firstToken, { method: 'GET', url: '/api/v1/auth/me' })))
          .statusCode,
      ).toBe(200);

      await app.inject(asUser(firstToken, { method: 'POST', url: '/api/v1/auth/logout' }));
      expect(
        (await app.inject(asUser(firstToken, { method: 'GET', url: '/api/v1/auth/me' })))
          .statusCode,
      ).toBe(401);

      const signedIn = await post('login', { email: input.email, password: input.password });
      const secondToken = sessionCookieFrom(signedIn) ?? '';

      expect(
        (await app.inject(asUser(secondToken, { method: 'GET', url: '/api/v1/auth/me' })))
          .statusCode,
      ).toBe(200);
    });
  });
});
