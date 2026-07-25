import { createHash, randomBytes } from 'node:crypto';

/** 256 bits. Guessing one is not a threat model, it is a rounding error. */
const TOKEN_BYTES = 32;

/**
 * Opaque session tokens.
 *
 * The token is a random string with no structure and no meaning — it is a lookup key, not a
 * claim. That is the whole point of choosing it over a JWT: a server-side session can be revoked
 * the instant a host removes someone from a group, and a stateless token cannot.
 *
 * What reaches the database is the SHA-256 of the token, never the token itself. A leaked dump
 * therefore contains no usable sessions: an attacker would have to invert SHA-256 to produce a
 * cookie that hashes to a stored row.
 *
 * Plain SHA-256 rather than argon2 is correct here, and the difference matters: a password is
 * low-entropy and needs a slow hash to survive a dictionary attack, while a 256-bit random token
 * has nothing to guess. A slow hash would only add latency to every authenticated request.
 */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * A stored token hash.
 *
 * Prisma 6 types `Bytes` as `Uint8Array<ArrayBuffer>` in both directions — specifically that,
 * not Node's `Buffer` and not the wider `ArrayBufferLike`. Naming the type once keeps the
 * distinction from leaking into every signature that touches a hash.
 */
export type TokenHash = Uint8Array<ArrayBuffer>;

/** The value stored in `auth_sessions.token_hash`, and the key sessions are looked up by. */
export function hashSessionToken(token: string): TokenHash {
  const digest = createHash('sha256').update(token, 'utf8').digest();
  const hash: TokenHash = new Uint8Array(new ArrayBuffer(digest.byteLength));

  hash.set(digest);

  return hash;
}
