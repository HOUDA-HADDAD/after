import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { SESSION_COOKIE_NAME_INSECURE } from '@aftergame/shared';

export const TEST_COOKIE_NAME = SESSION_COOKIE_NAME_INSECURE;

export interface Credentials {
  username: string;
  email: string;
  password: string;
}

let counter = 0;

export const credentials = (overrides: Partial<Credentials> = {}): Credentials => {
  counter += 1;
  const suffix = String(counter).padStart(3, '0');

  return {
    username: `player${suffix}`,
    email: `player${suffix}@example.com`,
    password: 'a decently long passphrase',
    ...overrides,
  };
};

export type { InjectResponse };

/** The session cookie a response set, or undefined when it set none. */
export function sessionCookieFrom(response: InjectResponse): string | undefined {
  const cookie = response.cookies.find((entry) => entry.name === TEST_COOKIE_NAME);
  return cookie?.value;
}

/** Register an account and return the credentials plus the resulting session token. */
export async function registerUser(
  app: FastifyInstance,
  overrides: Partial<Credentials> = {},
): Promise<{ credentials: Credentials; token: string; userId: string }> {
  const input = credentials(overrides);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: input,
  });

  if (response.statusCode !== 201) {
    throw new Error(`Registration failed: ${String(response.statusCode)} ${response.body}`);
  }

  const token = sessionCookieFrom(response);
  if (token === undefined) throw new Error('Registration set no session cookie');

  return { credentials: input, token, userId: response.json().user.id as string };
}

/** Make a request as a signed-in user. */
export const asUser = (token: string, options: InjectOptions): InjectOptions => ({
  ...options,
  cookies: { ...options.cookies, [TEST_COOKIE_NAME]: token },
});
