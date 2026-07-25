import { describe, it, expect } from 'vitest';
import { loadEnv } from '@aftergame/config';
import { argon2ParamsFrom, createPasswordHasher } from './password.js';

// Deliberately cheap: these tests are about behaviour, not about how long argon2 takes.
const testParams = { memoryCost: 8192, timeCost: 1, parallelism: 1 };
const hasher = createPasswordHasher(testParams);

describe('argon2ParamsFrom', () => {
  it('defaults to the OWASP minimum parameters', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://a:b@localhost:5432/c',
      SESSION_SECRET: 'x'.repeat(32),
    });

    // m = 19456 KiB, t = 2, p = 1 — raising these is a config change, not a code change.
    expect(argon2ParamsFrom(env)).toEqual({
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  });
});

describe('password hashing', () => {
  it('produces an argon2id hash carrying its own parameters', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).toContain('m=8192');
    expect(hash).toContain('t=1');
    expect(hash).toContain('p=1');
  });

  it('salts each hash, so identical passwords do not collide', async () => {
    const [first, second] = await Promise.all([
      hasher.hash('same password'),
      hasher.hash('same password'),
    ]);

    expect(first).not.toBe(second);
  });

  it('verifies a correct password', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    await expect(hasher.verify(hash, 'Correct horse battery staple')).resolves.toBe(false);
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    // A corrupted row must fail the login, not crash the request handler.
    await expect(hasher.verify('not-a-hash', 'anything')).resolves.toBe(false);
    await expect(hasher.verify('', 'anything')).resolves.toBe(false);
  });

  it('always fails the dummy verification', async () => {
    await expect(hasher.verifyAgainstDummy('anything at all')).resolves.toBe(false);
  });

  it('verifies hashes produced with different parameters', async () => {
    // Parameters are stored in the encoded hash, so raising them does not lock anyone out.
    const weaker = createPasswordHasher({ memoryCost: 8192, timeCost: 1, parallelism: 1 });
    const stronger = createPasswordHasher({ memoryCost: 16384, timeCost: 2, parallelism: 1 });

    const oldHash = await weaker.hash('a password from before the upgrade');

    await expect(stronger.verify(oldHash, 'a password from before the upgrade')).resolves.toBe(
      true,
    );
  });
});
