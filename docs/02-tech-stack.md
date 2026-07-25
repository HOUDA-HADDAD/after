# 02 — Technology choices and why

Every item is open source, free, and self-hostable. Where we rejected a popular option, the
reason is stated — a choice without a rejected alternative is not a decision.

---

## Summary

| Concern          | Choice                                              | Licence               |
| ---------------- | --------------------------------------------------- | --------------------- |
| Language         | TypeScript 5.7 (strict)                             | Apache-2.0            |
| Repo             | pnpm workspaces + Turborepo                         | MIT                   |
| Frontend         | React 19 + Vite 6                                   | MIT                   |
| Routing          | React Router 7 (declarative)                        | MIT                   |
| Styling          | Tailwind CSS 4                                      | MIT                   |
| Components       | shadcn/ui (Radix UI primitives)                     | MIT                   |
| Icons            | lucide-react                                        | ISC                   |
| Animation        | Motion (`motion`, ex-Framer Motion)                 | MIT                   |
| Server state     | TanStack Query 5                                    | MIT                   |
| Client state     | Zustand 5                                           | MIT                   |
| Forms            | react-hook-form + `@hookform/resolvers`             | MIT                   |
| Validation       | Zod 3 (shared client ↔ server)                      | MIT                   |
| API server       | Fastify 5                                           | MIT                   |
| Real-time        | Socket.IO 4                                         | MIT                   |
| ORM              | Prisma 6                                            | Apache-2.0            |
| Database         | PostgreSQL 16                                       | PostgreSQL Licence    |
| Password hashing | argon2id via `@node-rs/argon2`                      | MIT                   |
| Scheduling       | node-cron                                           | ISC                   |
| Logging          | pino                                                | MIT                   |
| Tests            | Vitest 3, fast-check, embedded-postgres, Playwright | MIT                   |
| Lint/format      | ESLint 9 (flat) + Prettier                          | MIT                   |
| CI               | GitHub Actions                                      | free for public repos |
| Containers       | Docker + Docker Compose                             | Apache-2.0            |

---

## Frontend

### React 19 + TypeScript

Requested, and correct here. Mature ecosystem, the largest hiring pool, and React 19's stable
`useOptimistic`/Actions are a direct fit for "submit a comment and see it instantly" without
hand-rolled optimistic caches.

### Vite 6 SPA — _not_ Next.js

This is the most consequential frontend decision, so it deserves the argument.

The app is 100% authenticated, session-scoped, real-time, and behind a login wall. There is
nothing to server-render, nothing to index, no SEO surface. Meanwhile Next.js's free hosting
story (Vercel) does **not** support long-lived WebSocket connections, so we would end up running a
separate WebSocket process anyway — the exact split Next.js was supposed to save us from.

A Vite SPA + Fastify gives one API process that owns both HTTP and WS, sub-second dev HMR, a
trivially cacheable static bundle, and total freedom of host. If a marketing page is ever needed,
it is a separate static page, not a framework change.

### Tailwind CSS 4 + shadcn/ui

Tailwind v4's Oxide engine is dramatically faster and its CSS-variable-driven theming makes the
required light/dark mode a `class="dark"` toggle over token variables, with `localStorage`
persistence and light as the default.

shadcn/ui is not an npm dependency — components are generated into `packages/ui` as source you
own, built on **Radix UI** primitives. That matters for three reasons: accessibility (focus
traps, ARIA, keyboard behaviour) is handled by Radix and is genuinely hard to retrofit; there is
no runtime lock-in or version treadmill; and the Slack-like density and typography the brief asks
for require editing component internals, which is trivial when you own the file and painful when
you don't.

_Rejected:_ MUI (heavy, opinionated Material aesthetic fighting the Slack brief), Chakra
(runtime CSS-in-JS cost), Mantine (good, but a hard dependency where shadcn is owned source).

### TanStack Query + Zustand

Two kinds of state, two tools. Server state (groups, sessions, timelines) is cached, refetched,
invalidated and deduped by TanStack Query, whose cache we also mutate directly from WebSocket
events — so live updates and fetched data converge on one store. Purely local state (theme,
composer draft, modals) is a tiny Zustand store. Redux Toolkit would be ceremony for state this
small; Context alone would re-render the tree on every socket event.

### Motion, react-hook-form, Zod

Motion supplies the "smooth animations" requirement: phase transitions, timeline entry
staggering, and comment insertion — all respecting `prefers-reduced-motion`. Forms use
react-hook-form (uncontrolled, minimal re-render) with the **same Zod schemas the API validates
with**, imported from `packages/shared`. One definition of "a text is 1–1000 characters", used by
both sides. A client can never construct a request the server's schema disagrees with.

### Dictation & spellcheck — zero cost

`spellcheck="true"` plus a correct `lang` attribute gives native browser spell correction.
Dictation uses the **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`) —
built into Chrome, Edge and Safari, free, no key, no server round-trip. Firefox does not
implement it, so the microphone button is feature-detected and simply absent there. No paid AI
service anywhere, as required.

---

## Backend

### Fastify 5 — _not_ Express, _not_ NestJS

Fastify is the middle path this project wants. Against **Express**: Fastify has first-class
TypeScript types, schema-based request validation _and_ response serialization (which is both a
speed win and a security win — an unlisted field cannot accidentally be serialized, which is
directly useful for our anonymity boundary), a real plugin encapsulation model, and roughly 2–3×
the throughput. Against **NestJS**: Nest brings decorators, DI containers and module metadata
that pay off across dozens of teams and hundreds of endpoints; here it would be more framework
than domain. Fastify's plugin/`register` scoping already gives us module isolation without the
ceremony.

Response serialization is worth restating: we declare the exact response shape per route, and
Fastify serializes _only_ declared fields. If a service ever returns an entity with `authorId`
attached, the route schema drops it. That is a second, structural layer of defence under the
projection module.

### Socket.IO 4 — _not_ raw `ws`, _not_ SSE

Rooms, acknowledgements, automatic reconnection with backoff, and a well-tested fallback to HTTP
long-polling when a network or proxy blocks WebSockets. Writing that on top of `ws` is a month of
work reproducing known-good code. SSE is one-directional and would still need a REST write path
plus a separate connection per tab; the brief wants live comments and live game state, so
bidirectional-capable transport with rooms wins. Free-tier hosts that idle-sleep make automatic
reconnection non-negotiable.

### Prisma 6 + PostgreSQL 16

Prisma was requested and fits: the schema is the single source of truth, migrations are
versioned SQL files reviewable in PRs, and the generated client gives end-to-end type safety
including relation payloads. Its `$transaction` with `isolationLevel: 'Serializable'` is exactly
what the distribution critical section needs.

PostgreSQL because we rely on things SQLite and MySQL do not do as well: partial unique indexes
(one live session per group), `CHECK` constraints on the punishment range, transactional DDL,
`ON DELETE CASCADE` chains deep enough to make purging a one-row delete, advisory locks for job
leadership, and `citext` for case-insensitive email uniqueness. Free managed PostgreSQL is
plentiful; free managed anything-else is less so.

_Noted trade-off:_ Prisma's query builder cannot express every window function; Prisma 6's
`TypedSQL` handles the two or three analytical queries (guess leaderboards) with full type safety.

### argon2id via `@node-rs/argon2` — _not_ bcrypt

argon2id is the OWASP first recommendation for password storage, memory-hard against GPU attack
in a way bcrypt is not. `@node-rs/argon2` is a Rust binding with prebuilt binaries for Linux,
macOS and Windows — no `node-gyp` toolchain on developer machines, which matters because this
project is being built on Windows. Parameters: `m = 19456 KiB, t = 2, p = 1` (OWASP minimum),
stored in config so they can be raised without a code change.

### Authentication: a thin first-party session module — _not_ a framework

**Recommendation:** ~200 lines we own, implementing the well-trodden pattern:

- argon2id password verification with a constant-time dummy hash on unknown emails (no user
  enumeration via timing);
- a 256-bit opaque session token from `crypto.randomBytes`, sent as a cookie and stored in the
  database **SHA-256 hashed**, so a database leak does not hand over live sessions;
- `__Host-session` cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`;
- 30-day sliding expiry with rotation on privilege change, and full invalidation on logout.

**Why not a library?** The dangerous parts of auth are cryptographic primitives and protocol
flows — and we are using audited primitives (`argon2`, `crypto.randomBytes`) for exactly those.
What remains is cookie plumbing and a `sessions` table: small, explicit, fully testable, with no
opaque adapter behaviour at the point where our anonymity guarantees begin. Lucia — the library
that popularised this pattern — was deprecated in 2025 in favour of teaching it directly.

**Documented alternative:** if the team prefers a maintained library, **Better Auth** is the
choice (open source, TypeScript-native, self-hosted, Prisma adapter, email/password + sessions +
rate limiting built in). It is a Phase 1 swap behind our `AuthProvider` interface, and nothing
downstream changes. _Rejected:_ Auth.js/NextAuth (OAuth-shaped, awkward for credential-only
non-Next apps), Passport (unmaintained strategy sprawl), any hosted identity provider (paid at
scale, external dependency, contradicts self-hosting).

---

## Tooling

### pnpm workspaces + Turborepo

The monorepo exists to let the client import the server's Zod schemas and error codes — that
shared contract is what prevents client/server drift. pnpm's content-addressed store makes this
fast and disk-cheap; Turborepo caches `lint`/`typecheck`/`test`/`build` per package so CI only
re-runs what changed. Both free and open source; Turborepo requires no account for local caching.

### Vitest 3 + fast-check + embedded-postgres + Playwright

Vitest shares Vite's transform pipeline, so there is one config and near-instant watch mode.
**fast-check** is the reason `game-core` is pure: property-based tests generate thousands of
player/punishment configurations and assert the distribution invariants, which is the only
credible way to test a randomised algorithm. **embedded-postgres** runs the official PostgreSQL
16 binaries for the integration suite when no database is already available — no SQLite
substitute and no WASM approximation, because we depend on PostgreSQL-specific constraints and
on their _error_ behaviour, so anything that is merely Postgres-like would validate nothing (see
[08](08-testing.md) for the alternatives we rejected and why). **Playwright** drives three
browser contexts at once to play a real three-player game end to end, including WebSocket
traffic.

### ESLint 9 flat config + Prettier

Plus three project-specific custom rules that encode our invariants as lint errors rather than
review comments:

1. `no-prisma-outside-repositories` — services must not touch the client directly.
2. `no-imports-in-game-core` — the domain package stays pure.
3. `no-identity-fields-in-dto` — DTO builders may not reference `authorId`, `revealVote` or
   `choice` outside the sanctioned projection module.

---

## Version policy

Node 22 LTS is the floor (Fastify 5 requires ≥20; the developer machine runs 24). Dependencies
are pinned exactly in the lockfile, Renovate runs weekly grouped PRs, and every upgrade must pass
the full CI matrix. No dependency enters the tree without a licence check — the CI job fails on
anything outside the MIT/ISC/Apache-2.0/BSD/PostgreSQL set.
