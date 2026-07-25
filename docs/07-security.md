# 07 — Security

## Threat model

This is a private-group app whose product promise is anonymity. The realistic adversaries are, in
descending order of likelihood:

| #   | Adversary                             | Goal                                  | Primary controls                                                                                  |
| --- | ------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| T1  | **A curious player inside the group** | Work out who wrote what               | Server-side projection, shuffled order, aggregate-only progress, no assignment map, no vote tally |
| T2  | **An outsider with a group id**       | Read a private group's content        | Membership check on every route; 404 (not 403) for non-members                                    |
| T3  | **A malicious client**                | Forge requests, escalate role, replay | Zod validation, `authorize()` on every route, phase guards, database constraints                  |
| T4  | **A code-guesser**                    | Brute-force invitation codes          | 40-bit random codes, per-IP and per-account rate limits, uniform errors                           |
| T5  | **Credential attacker**               | Take over an account                  | argon2id, no user enumeration, rate limits, hashed session tokens                                 |
| T6  | **Someone with a database dump**      | Replay sessions, read passwords       | Password hashes are argon2id; session tokens are SHA-256 at rest; game content purged             |
| T7  | **A hostile web page**                | CSRF against a logged-in user         | `SameSite=Lax` + `__Host-` prefix + Origin verification                                           |

**T1 is the one that matters most** and the one most projects get wrong. It is addressed in
[01 §3](01-architecture.md#3-the-anonymity-boundary) as an architectural boundary rather than a
list of patches.

---

## Authentication

- **argon2id**, parameters `m = 19456 KiB, t = 2, p = 1` (OWASP minimum), held in config so they
  can be raised without code changes. Encoded hash carries its own salt and parameters, so old
  hashes stay verifiable after an upgrade and can be re-hashed on next successful login.
- **No user enumeration.** An unknown email still runs a verification against a fixed dummy hash,
  so response timing is flat. Register, login and password-reset failures return one generic
  message.
- **Opaque session tokens**: 256 bits from `crypto.randomBytes`, base64url-encoded in the cookie,
  **SHA-256 hashed in the database**. A leaked dump yields no usable sessions. Lookup is by hash,
  so it is still a single indexed query.
- **Cookie**: `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`. The
  `__Host-` prefix is only accepted by browsers under exactly those conditions, which makes
  subdomain-injection attacks structurally impossible.
- **Lifetime**: 30-day sliding expiry, refreshed at most once per hour to avoid a write per
  request. Logout deletes the row (not just the cookie). Password change invalidates all other
  sessions.
- **No JWTs.** Server-side sessions are revocable instantly; a stateless token is not. For an app
  where "remove this member / block this player" must take effect immediately, revocability wins,
  and the database round-trip is a single indexed lookup we are already making.

## Authorization

One policy engine, `authorize(actor, action, resource)`, with a closed union of actions. Every
route names its action; **a meta-test enumerates the route table and fails the build if any route
lacks a policy declaration.** Forgetting a check becomes a red CI run rather than an incident.

Layered checks, in order:

1. **Authenticated?** → 401.
2. **Member of the group?** → **404**, deliberately, so group and session ids are not confirmable
   by an outsider. (403 would confirm existence.)
3. **Role sufficient?** Owner ⊃ co-host ⊃ member, with the co-host asymmetry from
   [D16](00-spec-decisions.md#d16-ownership-co-hosts-and-the-host-concept).
4. **Correct phase?** `game-core/phases.allowedActions(phase, role)`.
5. **Owns the resource?** You may only submit your own text, answer your own assignment, edit your
   own draft.

Every read is scoped by membership in the query itself (`WHERE group_id IN (my groups)`), rather
than fetched-then-checked — IDOR is prevented at the query, not after it.

## Input validation

Three layers, deliberately redundant:

| Layer   | Tool                               | Purpose                                           |
| ------- | ---------------------------------- | ------------------------------------------------- |
| Edge    | Zod schemas from `packages/shared` | Shape, type, length, format — good error messages |
| Domain  | `game-core` guards                 | Rules: phase legality, quotas, punishment ranges  |
| Storage | PostgreSQL `CHECK`, `UNIQUE`, FKs  | The constraint that cannot be bypassed by any bug |

Since the client validates with the _same Zod schemas_, client and server can never disagree
about what is valid. Fastify response schemas additionally serialize only declared fields, so an
entity that accidentally carries `authorId` cannot leak through a route.

**Injection:** Prisma parameterises everything; the two or three raw queries use `TypedSQL` with
bound parameters. No string-concatenated SQL exists in the codebase, enforced by lint.

**XSS:** React escapes by default and we render no user content as HTML — no markdown, no rich
text, no `dangerouslySetInnerHTML` (lint-banned). Combined with a strict CSP, stored XSS has no
surface.

## Transport & headers

`@fastify/helmet` with an explicit policy:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
                         img-src 'self' data:; connect-src 'self' ws: wss:;
                         frame-ancestors 'none'; base-uri 'none'; object-src 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), camera=(), microphone=(self)
```

`microphone=(self)` is required for Web Speech dictation and is scoped to our own origin.
Single-origin deployment means CORS is **off** in production; in development the Vite proxy keeps
the browser on one origin too.

## CSRF

`SameSite=Lax` blocks cross-site cookie attachment on all state-changing methods, and every
mutating request additionally has its `Origin` header verified against an allowlist — requests
with a missing or foreign Origin are rejected. With a single origin and the `__Host-` prefix,
token-based double-submit adds nothing and is omitted deliberately.

## Rate limiting

`@fastify/rate-limit`, keyed by user id where authenticated and by IP otherwise:

| Route group                               | Limit                                  |
| ----------------------------------------- | -------------------------------------- |
| `POST /auth/login`, `/auth/register`      | 5 / 15 min per IP, 10 / hour per email |
| `POST /invitations/redeem`                | 10 / hour per IP **and** per account   |
| Content writes (texts, answers, comments) | 30 / min per user                      |
| Everything else                           | 300 / min per user                     |

Invitation-code redemption is the one endpoint where an attacker gets unlimited guesses, so it
gets the tightest budget and uniform error responses regardless of failure reason.

## Secrets & configuration

All configuration comes from environment variables, validated at boot by a Zod schema in
`packages/config`. **The process refuses to start** on a missing or malformed value — no silent
defaults for anything security-relevant, and `SESSION_SECRET` is rejected if it is shorter than
32 bytes or equal to the example value. Secrets never appear in the repository; `.env.example`
carries names and shapes only. CI runs a secret scanner (`gitleaks`) on every push.

## Logging & privacy

Pino with serializer-level redaction of `password`, `body`, `text`, `answer`, `comment`,
`token`, `cookie` and `authorization`. **Game content is never written to a log**, because a log
file that records who submitted which text defeats the entire product. We log ids, phases,
durations and error codes. IP addresses are stored hashed on `auth_sessions` for the
"sign out other devices" feature and nowhere else.

## Database hardening

- The application connects as a least-privilege role with `SELECT/INSERT/UPDATE/DELETE` and no
  DDL. Migrations run as a separate, more privileged role during release only.
- Connection string requires TLS in production (`sslmode=require`).
- Connection pool bounded and sized to the host's `max_connections`; on serverless PostgreSQL, a
  pooled connection string is used.
- Cascade chains are designed so that purge is a single statement
  ([03](03-database-schema.md#retention--purge)) — deletion cannot be partial and leave orphaned
  content behind.

## Dependency & supply chain

- `pnpm audit` in CI, failing at moderate and above.
- Licence allowlist job (MIT / ISC / Apache-2.0 / BSD / PostgreSQL); anything else fails the build.
- Renovate weekly, grouped, with the full test suite as the gate.
- Exact lockfile pins; `pnpm install --frozen-lockfile` in CI and in the production image.
- Production image runs as a non-root user with a read-only filesystem apart from `/tmp`.

## Anonymity-specific controls (T1)

Restating these here because they are security controls, not UI preferences:

1. Identifiers are stripped **server-side** before serialization — never hidden client-side.
2. One projection function handles both REST and WebSocket payloads; there is no second path.
3. Display order is seeded and shuffled, never submission order.
4. Progress is aggregate-only (`6 / 8`), never per-name.
5. The text→receiver assignment map is never exposed to anyone, including hosts.
6. Reveal votes are read by exactly one function, which returns a single collective boolean; the
   yes/no split is never computed anywhere in the codebase.
7. Anonymous comments carry no stable pseudonym, so repeat comments are uncorrelatable.
8. Answer-count differences caused by punishment are visible in the lobby (a game rule) but never
   attached to answers in the timeline.
9. A dedicated regression suite asserts every one of the above on serialized output
   ([08](08-testing.md#anonymity-regression-suite)).

## Known limitations, stated honestly

- **Writing style is identifying.** No software can prevent friends recognising each other's
  phrasing. We protect against _systemic_ leaks, not stylometry.
- **The collective reveal outcome is inherently informative.** Under unanimity
  ([D8](00-spec-decisions.md#d8-reveal-is-collective--unanimous-or-nobody)) a failed reveal tells
  everyone that at least one person refused. With eight players the refuser is hidden among seven;
  **with two players they are identified outright**. This follows from the rule, not the
  implementation, so it cannot be engineered away — the vote screen warns players in small games
  instead.
- **A database administrator can read live game content.** Content is purged after the grace
  window, but during a game it is readable by anyone with database access. End-to-end encryption
  would prevent this and would also make the server unable to distribute texts — out of scope.
- **No email verification in v1.** Anyone can register with any address. Acceptable because
  groups are invite-only and there is no public surface; revisit if password reset ships.
