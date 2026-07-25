import { hash, verify } from '@node-rs/argon2';
import type { Env } from '@aftergame/config';

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export const argon2ParamsFrom = (env: Env): Argon2Params => ({
  memoryCost: env.ARGON2_MEMORY_KIB,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
});

/**
 * Password hashing.
 *
 * argon2id with the OWASP minimum parameters (m = 19456 KiB, t = 2, p = 1), held in config so
 * they can be raised on a machine with more memory without a code change. The encoded hash
 * carries its own salt and parameters, so old hashes stay verifiable after an upgrade.
 *
 * argon2id is memory-hard in a way bcrypt is not: an attacker with a GPU farm has to pay for
 * 19 MiB of memory per guess, which is what turns a stolen dump from a weekend of cracking into
 * something uneconomic.
 */
export function createPasswordHasher(params: Argon2Params) {
  /**
   * `algorithm` is left at the library default, which is Argon2id.
   *
   * Naming it explicitly would mean importing an ambient `const enum`, which `verbatimModuleSyntax`
   * forbids — and casting around that would be worse than relying on a default we verify: the
   * unit tests assert the produced hash starts with `$argon2id$`, so a change in that default
   * fails the build rather than silently downgrading everyone's password hashing.
   */
  const options = {
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  } as const;

  /**
   * A hash of a value nobody knows, verified against when the email is unrecognised.
   *
   * Without this, "no such user" returns in microseconds while a real account costs a full argon2
   * verification — and that difference is a reliable oracle for enumerating who has an account
   * here. Computed once, lazily, because it costs a full hash.
   */
  let dummyHash: Promise<string> | undefined;

  const getDummyHash = (): Promise<string> => {
    dummyHash ??= hash('a password that is never anyone’s password', options);
    return dummyHash;
  };

  return {
    async hash(password: string): Promise<string> {
      return hash(password, options);
    },

    /** Verify a password against a stored hash. Never throws on a malformed hash — returns false. */
    async verify(storedHash: string, password: string): Promise<boolean> {
      try {
        return await verify(storedHash, password);
      } catch {
        return false;
      }
    },

    /**
     * Burn the same work as a real verification, then fail.
     *
     * Call this on the unknown-email path so response timing does not distinguish
     * "no such account" from "wrong password".
     */
    async verifyAgainstDummy(password: string): Promise<false> {
      await verify(await getDummyHash(), password).catch(() => false);
      return false;
    },

    /** Warm the dummy hash so the first failed login is not measurably slower than the rest. */
    async warmUp(): Promise<void> {
      await getDummyHash();
    },
  };
}

export type PasswordHasher = ReturnType<typeof createPasswordHasher>;
