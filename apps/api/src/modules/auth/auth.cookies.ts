import { SESSION_COOKIE_NAME, SESSION_COOKIE_NAME_INSECURE } from '@aftergame/shared';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { Env } from '@aftergame/config';

/**
 * Session cookie policy.
 *
 * The `__Host-` prefix is the strongest guarantee a cookie can carry: browsers accept it only
 * when the cookie is `Secure`, has `Path=/`, and has **no** `Domain` attribute. That combination
 * makes it impossible for a compromised sibling subdomain to write a session cookie for us —
 * an attack that no amount of server-side code can otherwise prevent.
 *
 * The prefix requires `Secure`, which browsers refuse over plain http, so development uses an
 * unprefixed name. That is the one place the two environments differ, and it is unavoidable.
 */
export function sessionCookieName(env: Env): string {
  return env.NODE_ENV === 'production' ? SESSION_COOKIE_NAME : SESSION_COOKIE_NAME_INSECURE;
}

export function sessionCookieOptions(env: Env, maxAgeSeconds: number): CookieSerializeOptions {
  return {
    // Unreadable from JavaScript, so an XSS bug cannot exfiltrate the session.
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    // Lax, not Strict: Strict would drop the cookie when a player follows an invite link from
    // their chat app and land them on a login screen they do not need. Lax still blocks the
    // cross-site POSTs that CSRF depends on, and the Origin check covers the rest.
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Clearing must repeat the attributes the cookie was set with, or the browser keeps it. */
export function clearedSessionCookieOptions(env: Env): CookieSerializeOptions {
  return { ...sessionCookieOptions(env, 0), maxAge: 0, expires: new Date(0) };
}
