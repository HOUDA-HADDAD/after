# 04 — Main application modules & folder structure

## Folder structure

```
aftergame/
├── apps/
│   ├── api/                              # Fastify server — HTTP + WebSocket + jobs
│   │   ├── src/
│   │   │   ├── main.ts                   # composition root: build → listen → graceful shutdown
│   │   │   ├── app.ts                    # Fastify instance, plugin registration order
│   │   │   ├── plugins/                  # cross-cutting Fastify plugins
│   │   │   │   ├── prisma.ts             # client lifecycle, decorates app
│   │   │   │   ├── auth.ts               # cookie → session → request.user
│   │   │   │   ├── security.ts           # helmet, rate limit, origin check
│   │   │   │   ├── error-handler.ts      # AppError → problem+json
│   │   │   │   ├── request-context.ts    # request id, pino child logger
│   │   │   │   └── static.ts             # serves the built SPA in production
│   │   │   ├── modules/                  # one folder per bounded capability
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── groups/
│   │   │   │   ├── memberships/
│   │   │   │   ├── invitations/
│   │   │   │   ├── punishments/
│   │   │   │   ├── themes/
│   │   │   │   ├── sessions/             # lifecycle + phases + distribution orchestration
│   │   │   │   ├── texts/
│   │   │   │   ├── answers/
│   │   │   │   ├── comments/
│   │   │   │   ├── guesses/
│   │   │   │   ├── reveal/
│   │   │   │   └── timeline/             # read model — the projection endpoint
│   │   │   ├── realtime/
│   │   │   │   ├── server.ts             # Socket.IO attach + handshake auth
│   │   │   │   ├── rooms.ts              # room naming + join authorization
│   │   │   │   └── emitters.ts           # event bus → per-socket projected emits
│   │   │   ├── jobs/
│   │   │   │   ├── scheduler.ts          # node-cron + advisory lock wrapper
│   │   │   │   ├── purge-sessions.job.ts
│   │   │   │   ├── abandon-stale.job.ts
│   │   │   │   └── prune-auth.job.ts
│   │   │   └── lib/
│   │   │       ├── authorize.ts          # the single policy engine
│   │   │       ├── event-bus.ts
│   │   │       ├── password.ts           # argon2id wrapper
│   │   │       └── tokens.ts             # opaque token generate/hash/compare
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts                   # idempotent theme seed
│   │   └── tests/
│   │       ├── integration/              # app.inject() against a real Postgres
│   │       └── helpers/                  # factories, test db lifecycle
│   │
│   └── web/                              # React SPA
│       ├── src/
│       │   ├── main.tsx
│       │   ├── app/                      # router, providers, error boundary, theme
│       │   ├── features/                 # vertical slices, mirroring API modules
│       │   │   ├── auth/                 # login, register, session bootstrap
│       │   │   ├── groups/               # list, create, join by code, settings
│       │   │   ├── members/              # roster, roles, transfer ownership
│       │   │   ├── punishments/          # punish / forgive UI + history
│       │   │   ├── game-lobby/           # theme picker, roster, start
│       │   │   ├── game-writing/         # composer + progress
│       │   │   ├── game-answering/       # assignment queue + composer
│       │   │   ├── timeline/             # cards, comments, guesses
│       │   │   └── reveal/               # private vote + revealed view
│       │   ├── shared/
│       │   │   ├── api/                  # typed fetch client + TanStack Query hooks
│       │   │   ├── realtime/             # socket provider + cache-patching handlers
│       │   │   ├── components/           # app-level composites (AppShell, EmptyState…)
│       │   │   ├── hooks/                # useSpeechRecognition, useMediaQuery, …
│       │   │   └── lib/                  # formatting, error-code → copy map
│       │   └── styles/
│       ├── e2e/                          # Playwright specs
│       └── index.html
│
├── packages/
│   ├── game-core/                        # ⭐ pure domain — zero dependencies
│   │   ├── src/
│   │   │   ├── distribution.ts           # the assignment algorithm + invariants
│   │   │   ├── punishment.ts             # level → demand, escalate, reset, forgive
│   │   │   ├── phases.ts                 # state machine + guards
│   │   │   ├── visibility.ts             # entitlement + projection rules
│   │   │   ├── rng.ts                    # seeded PRNG (xoshiro128**)
│   │   │   └── types.ts
│   │   └── tests/                        # unit + fast-check property tests
│   ├── shared/                           # contracts shared by web and api
│   │   ├── src/
│   │   │   ├── schemas/                  # Zod: request bodies, params, DTOs
│   │   │   ├── dto/                      # inferred DTO types
│   │   │   ├── errors.ts                 # AppError codes enum
│   │   │   └── constants.ts              # limits: 1000 chars, 2 players, 3 punishments
│   ├── ui/                               # shadcn/ui components + design tokens
│   └── config/                           # env schema (Zod), tsconfig/eslint bases
│
├── docs/                                 # these documents
├── docker/                               # Dockerfile, compose, Caddyfile
├── .github/workflows/                    # CI
├── turbo.json  ·  pnpm-workspace.yaml  ·  .env.example
```

**Module anatomy.** Every API module is the same five files, which makes the codebase navigable
by anyone on day one:

```
modules/sessions/
├── sessions.routes.ts        # HTTP surface: Zod schemas in, DTOs out, no logic
├── sessions.service.ts       # use cases, transactions, assertCan() calls, events
├── sessions.repository.ts    # Prisma only; returns entities
└── sessions.mapper.ts        # entity → DTO, via game-core/visibility
```

**Policies are central, not per-module.** An earlier draft gave each module its own
`*.policy.ts`; in practice the rules are one small matrix over one closed action union, and
splitting it across files would have made "who can remove a co-host?" a question you answer by
reading four files. It lives in `src/lib/authorize.ts`, and module services call `assertCan`.

**Feature slice anatomy** on the web side is equally uniform: `routes.tsx`, `api.ts` (query
hooks), `components/`, `hooks/`.

---

## Backend modules

### `auth`

Registration, login, logout, `GET /me`, and "sign out everywhere". Owns password hashing
(argon2id), opaque token issuance, cookie handling, and the constant-time unknown-email path.
Exposes an `AuthProvider` interface so the implementation could be swapped for Better Auth
without touching any caller.

### `users`

Thin. Account reads and username/password changes. No public profiles, so there is no user
search, no user-by-id endpoint, and no way to see anyone you do not share a group with.

### `groups`

Create, rename, delete (owner only, with a typed confirmation), and "my groups". Delete cascades
everything the group owns, including any live session.

### `memberships`

Roster reads, role changes (promote/demote co-host), member removal, self-leave, and ownership
transfer. Enforces the co-host asymmetry from
[D16](00-spec-decisions.md#d16-ownership-co-hosts-and-the-host-concept): only an owner may act on
a co-host, and the owner cannot leave without transferring first. All of this runs through
`authorize()`.

### `invitations`

Generate, list, revoke, and redeem codes. Redemption is heavily rate limited (per IP _and_ per
account) and returns an identical error for "no such code", "expired", "revoked" and "exhausted",
so codes cannot be probed. Redeeming while already a member is idempotent.

### `punishments`

`punish`, `forgive`, and a group's punishment history. Every call writes a `punishment_events`
row in the same transaction as the counter update. Owns the escalation rules by delegating to
`game-core/punishment` — the module holds no arithmetic of its own.

### `themes`

Read-only listing for the theme picker, plus the idempotent seed. Capability flags from the theme
row are attached to the session state so the client renders comments/guessing without hardcoding
theme slugs.

### `sessions` — the orchestrator

The largest module, and the one under the most test pressure. Owns:

- create (LOBBY), join, leave, cancel;
- start: eligibility filter (`ACTIVE` members only — `GAME_BLOCKED` players are excluded), the
  ≥2 check, roster lock, `required_text_count`, seed generation;
- phase transitions, each guarded by `game-core/phases`;
- **the distribution critical section** — one `SERIALIZABLE` transaction, `SELECT … FOR UPDATE`
  on the session, status re-assertion, call into `game-core/distribution`, bulk insert of
  assignments, phase flip. Idempotent by construction: a second caller finds the status already
  advanced and no-ops;
- completion: writes punishment resets + audit rows, sets `purge_after`;
- `GET /sessions/:id/state` — the full snapshot used on load and on every WS reconnect.

### `texts`, `answers`

Draft autosave (debounced `PATCH`), submit, and the "my assignments" queue. Both enforce the
1000-character limit and the non-empty rule at three layers (Zod → domain → `CHECK` constraint),
and both refuse writes outside their phase. Submitted content is immutable — editing is a
pre-submission affordance only, exactly as the brief specifies.

### `comments`, `guesses`

Comment create/list scoped to an answer, gated on `theme.supports_comments`. Guess upsert gated
on `theme.supports_author_guess` and closed when `REVIEW` ends. Guess _correctness_ is never
computed outside the entitled projection.

### `reveal`

Opens the vote, accepts one private YES/NO per player, and reports `decided / total` only —
never the split. Closes when every participant has voted or when the host closes it. Owns
`getSessionEntitlement()`, the one function permitted to read `reveal_votes`, which returns a
single boolean: **did every remaining participant vote YES?** Abstention counts as NO; players
who left before `REVEAL` are excluded from the denominator
([D8](00-spec-decisions.md#d8-reveal-is-collective--unanimous-or-nobody)).

### `timeline` — the read model

A single endpoint assembling texts → answers → comments → guesses for a session, then passing the
whole structure through `game-core/visibility.projectTimeline(viewer, …)`. Ordering comes from
`display_seed`. This is the only place game content is assembled for output, which is precisely
why the anonymity guarantee is auditable: there is one function to review.

### `realtime`

Handshake auth, room authorization, and the bus subscriber that fans out. Identity-bearing events
are emitted per socket through the same projection; identity-free events (phase, progress) are
broadcast to the room.

### `jobs`

The four scheduled tasks, each wrapped in a PostgreSQL advisory lock so multiple instances are
safe.

### `lib/authorize.ts`

One policy engine: `can(action, actor, target)` over a closed union of actions (`'session:start'`,
`'member:remove'`, `'punishment:forgive'`, …). Pure and exhaustively switched, so adding an action
without deciding who may perform it does not compile.

Enforcement is declarative: every `/api` route sets `config.policy`, and `plugins/route-policy.ts`
**refuses to start the server** if one does not — as well as attaching authentication to anything
that is not `public`. Forgetting an authorization check is a boot failure, not a vulnerability.

---

## The `game-core` package

Zero imports. Everything else in the system is plumbing around these five files.

| File              | Exports                                                                              | Why it matters                                                             |
| ----------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `distribution.ts` | `distribute(texts, players, demands, seed) → Assignment[]`                           | The Gale–Ryser greedy with the repair pass; invariants I1–I5               |
| `punishment.ts`   | `demandFor(level, n)`, `escalate`, `resetIfUnpunished`, `forgive`, `isBlocked`       | All punishment arithmetic in one testable place                            |
| `phases.ts`       | `canTransition(from, to, ctx)`, `nextPhase(session)`, `allowedActions(phase, role)`  | Illegal transitions are unrepresentable                                    |
| `visibility.ts`   | `entitlement(session, votes)`, `projectText/Answer/Comment/Guess`, `projectTimeline` | **The anonymity boundary** — collective entitlement, per-viewer projection |
| `rng.ts`          | `seededRng(seed)`, `shuffle`, `pick`                                                 | Determinism → reproducible games in tests                                  |

Time and randomness are parameters, never ambient. `Date.now()` and `Math.random()` do not appear
in this package, which is enforced by a lint rule.

---

## Frontend modules

### App shell

A Slack-inspired three-region layout: a slim group rail on the far left, a group sidebar
(members, punishment badges, live-game banner), and the main panel. On mobile the rail and
sidebar collapse into a drawer; the game panel is always full-bleed. Light is the default theme,
dark is a toggle persisted to `localStorage` and seeded from `prefers-color-scheme` on first
visit.

### Game screens

- **Lobby** — theme cards, roster with punishment badges and load previews ("Ahmed answers 3"),
  host controls, room code with copy button.
- **Writing** — a single large composer under a pinned theme banner (the brief requires the theme
  to be visible at all times), live `6 / 8` progress, character counter, mic button where
  supported, and a submit that is disabled on whitespace-only input with an inline warning.
- **Answering** — a queue of assignment cards; punished players simply see more cards, with no
  indication of _why_ another player's card count differs.
- **Timeline** — text → answers → comment thread, entries staggered in on mount, comments arriving
  live with an anonymous/named toggle in the composer, and the guess widget for Anecdotes.
- **Reveal** — a deliberately quiet two-button screen stating plainly that the choice is private,
  that the tally is never shown, and that **authors are revealed only if everyone agrees**. In 2-
  and 3-player games it adds the honest caveat that a failed reveal narrows down who refused. Then
  either the revealed timeline or the anonymous one, announced as a group outcome with no hint of
  how many said no.

### Cross-cutting UI

Skeleton loaders for every async surface (never a spinner on a full page), illustrated empty
states for "no groups", "no live game", "no comments yet", an error boundary per route,
Sonner toasts driven by the shared error-code map, and full keyboard operability inherited from
Radix. All animation respects `prefers-reduced-motion`.
