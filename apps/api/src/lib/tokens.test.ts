import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generateSessionToken, hashSessionToken } from './tokens.js';

describe('session tokens', () => {
  it('is 256 bits, base64url encoded', () => {
    const token = generateSessionToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));

    expect(tokens.size).toBe(1000);
  });

  it('is URL and cookie safe', () => {
    // base64url avoids +, / and = — characters that need escaping in a Set-Cookie header.
    for (let index = 0; index < 200; index += 1) {
      expect(generateSessionToken()).not.toMatch(/[+/=]/);
    }
  });

  it('hashes to 32 bytes of SHA-256', () => {
    const token = generateSessionToken();
    const hash = Buffer.from(hashSessionToken(token));

    expect(hash).toHaveLength(32);
    expect(hash.equals(createHash('sha256').update(token, 'utf8').digest())).toBe(true);
  });

  it('hashes deterministically, so lookup by hash finds the row', () => {
    const token = generateSessionToken();

    expect(Buffer.from(hashSessionToken(token)).equals(Buffer.from(hashSessionToken(token)))).toBe(
      true,
    );
  });

  it('produces different hashes for different tokens', () => {
    expect(hashSessionToken(generateSessionToken())).not.toEqual(
      hashSessionToken(generateSessionToken()),
    );
  });

  it('does not leak the token into its hash', () => {
    const token = generateSessionToken();

    // Stating the obvious, but this is the property the whole design rests on: what is stored
    // cannot be turned back into what the browser sends.
    expect(Buffer.from(hashSessionToken(token)).toString('base64url')).not.toBe(token);
  });
});
