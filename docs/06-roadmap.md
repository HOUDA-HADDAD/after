# 06 — Development roadmap

Ten phases. Each is independently reviewable, ends in a working (if incomplete) system, and has
an exit criterion that is objectively checkable rather than a feeling.

Effort figures assume one engineer working focused days; they are for sequencing, not commitment.

---

## Phase 0 — Foundations · ~2 days

Repository skeleton with the quality gates already switched on, so no phase can quietly lower
the bar afterwards.

- pnpm workspace + Turborepo pipelines; strict TypeScript base config
- ESLint 9 flat config + Prettier, plus the three custom rules
  (no Prisma outside repositories · no imports in `game-core` · no identity fields in DTOs)
- `packages/config`: Zod-validated environment schema that fails fast at boot; `.env.example`
- `docker-compose.yml` (PostgreSQL 16 + Adminer) for local dev
- Fastify skeleton with `/healthz`, `/readyz`, pino with redaction, problem+json error handler
- Vite + React skeleton that renders and calls `/healthz`
- GitHub Actions: install → lint → typecheck → test → build, with a PostgreSQL service
- `CONTRIBUTING.md`, PR template, conventional commits

**Exit:** `pnpm dev` brings up database + API + web on one origin; CI is green on an empty test
suite; a deliberately unused variable fails the build.

## Phase 1 — Data layer · ~2 days

- Full `schema.prisma` implementing [03](03-database-schema.md), including enums, `citext`,
  partial unique indexes, and `CHECK` constraints (raw SQL in the migration where Prisma cannot
  express them)
- Initial migration + idempotent theme seed (the three defaults with capability flags)
- Repository pattern established with one worked example
- Test database lifecycle helpers: an existing PostgreSQL via `TEST_DATABASE_URL`, otherwise an
  embedded PostgreSQL 16 started for the run — so DB tests need no Docker

**Exit:** `migrate deploy` on an empty database produces the full schema; seed is idempotent
across repeated runs; an integration test asserts every declared constraint actually rejects bad
data — including duplicate `(text_id, receiver_player_id)` and two live sessions in one group.

## Phase 2 — Authentication · ~3 days

- argon2id hashing with OWASP parameters; constant-time unknown-email path
- Opaque token issuance, SHA-256 at rest, `__Host-` cookie with `SameSite=Lax`
- `POST /auth/register|login|logout|logout-all`, `GET /me`, sliding expiry
- Origin-header CSRF check on all mutations; per-IP _and_ per-account rate limiting
- Web: register/login screens, session bootstrap, protected routes, auth error copy

**Exit:** integration tests cover register → login → authenticated request → logout →
401; a stolen database dump cannot be replayed as a session (tokens are hashed); timing on
unknown vs known email is indistinguishable in a benchmark test.

## Phase 3 — Groups, membership & invitations · ~3 days

- Group CRUD; membership roster; role changes; removal; self-leave; ownership transfer
- `can()` policy engine over a closed, exhaustively-checked action union; every `/api` route
  declares `config.policy` and the app **refuses to boot** if one does not
- Invitation generate/revoke/redeem with rate limiting and uniform failure messages
- Web: group list, create, join-by-code, group shell with sidebar and member list

**Exit:** an authorization test matrix (every role × every action × own/other group) passes; a
non-member receives 404 — not 403 — for every group route, so group existence does not leak.

## Phase 4 — Punishment system · ~2 days

- `game-core/punishment.ts`: `demandFor`, `escalate`, `resetIfUnpunished`, `forgive`, `isBlocked`
  — the first module of the pure package, with the 100% branch-coverage gate switched on
- API: punish, forgive, history; audit rows written in the same transaction as counter updates,
  with compare-and-set so two hosts pressing "punish" at once cannot lose one
- Web: punishment badges, punish/forgive controls, group punishment history, blocked-member banner

**Exit:** unit tests cover the full 0→1→2→3→forgive→0 cycle including the "completes a game
unpunished resets to 0" rule; a test proves counters in two groups are independent for the same
user.

## Phase 5 — `game-core`: the domain engine · ~4 days

The highest-value phase, and entirely testable without a database or a browser.

- `rng.ts` seeded PRNG; `phases.ts` transition table and guards
- `distribution.ts` — bipartite b-matching by augmenting paths, with self-assignment modelled as
  a forbidden edge (the greedy the design sketched satisfies I1–I4 but not I5; see
  [01 §5](01-architecture.md#5-random-distribution--the-core-algorithm))
- `visibility.ts` — entitlement + projection for texts, answers, comments, guesses, timelines
- Property tests with fast-check across `N ∈ [2, 40]` × random punishment levels

**Exit:** invariants I1–I4 hold on ≥10,000 generated cases; self-assignment is zero whenever
`N ≥ 3` and every `d(p) ≤ N−1`; the same seed always yields the same assignment; illegal phase
transitions are rejected exhaustively; **100% branch coverage on this package**, enforced in CI.

## Phase 6 — Session lifecycle API + real-time · ~5 days

- Session create/join/leave/cancel/start; roster lock; eligibility filtering
- Text draft/submit; the distribution critical section (`SERIALIZABLE` + `FOR UPDATE` + status
  re-assertion); answer draft/submit
- Phase transitions, force-advance, completion with punishment resets, `purge_after`
- `GET /sessions/:id/state` snapshot; timeline read model through the projection
- Socket.IO: handshake auth, room authorization, notification-only events, event bus
- Scheduled jobs: purge, abandon, prune — each under an advisory lock

**Exit:** an integration test plays a full 5-player game with one punished player end to end,
asserting every invariant at every phase; a concurrency test fires 20 simultaneous
"last text submitted" requests and proves distribution ran exactly once; the anonymity regression
suite passes ([08](08-testing.md)).

## Phase 7 — Frontend shell & design system · ~4 days

- `packages/ui`: design tokens, light/dark theming, typography scale, shadcn/ui components
- App shell: group rail, sidebar, main panel; mobile drawer; responsive breakpoints
- Typed API client, TanStack Query setup, socket provider with cache patching
- Skeletons, empty states, error boundaries, toasts, the error-code → copy map
- Accessibility pass: focus management, landmarks, `prefers-reduced-motion`

**Exit:** the shell renders group and member data at 320px, 768px and 1440px in both themes;
axe reports zero violations on every shell route; a forced offline socket reconnects and resyncs
without a page reload.

## Phase 8 — Game experience · ~6 days

- Lobby (theme picker, roster, punishment badges, load preview, host controls, room code)
- Writing (pinned theme banner, composer, autosave, character counter, empty-submit warning,
  Web Speech dictation with feature detection, live `n / N` progress)
- Answering (assignment queue, per-card composers, progress)
- Timeline (staggered cards, live comments with anonymous/named toggle, guess widget)
- Reveal (private vote screen with the unanimity rule and small-game caveat stated up front,
  revealed vs anonymous final views announced as a group outcome)

**Exit:** three humans (or three Playwright contexts) play a complete Anecdotes game including a
punishment, comments, guesses and both reveal outcomes, on both mobile and desktop viewports.

## Phase 9 — Hardening, tests & deployment · ~4 days

- Playwright E2E: multi-context full-game scenarios, disconnect/reconnect, force-advance,
  blocked-player, purge-window expiry
- Load sanity check (`autocannon`) on the hot endpoints; index review against `EXPLAIN` output
- Security pass: headers, rate limits, dependency audit, licence check, secret scan
- Production Dockerfile (multi-stage, non-root, distroless-ish), Caddy config, compose file
- Deploy the free path end to end; document environment variables and database setup
- Backup script for the durable zone; runbook for restore

**Exit:** a clean clone deploys to production following [09](09-deployment.md) with no undocumented
step; E2E is green in CI; `pnpm audit` is clean at moderate and above.

## Phase 10 — Polish & stretch · ongoing

Ordered by value, all optional. Two are done; the rest stay on the list, which is what "ongoing"
means.

| #   | Item                                                                                                                     | Status                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | Password reset                                                                                                           | **Not started.** Needs an outbound email provider — a product decision about which, not an engineering one.    |
| 2   | Group-custom themes ([D19](00-spec-decisions.md#d19-a-group-may-write-its-own-themes-the-seeded-three-belong-to-nobody)) | **Done.** Needed a schema change after all: `themes` had `is_system` but no owner.                             |
| 3   | Per-phase timers with automatic advance                                                                                  | Not started. The host can already force every transition (D14), so this is convenience rather than capability. |
| 4   | Reactions on answers ([D20](00-spec-decisions.md#d20-reactions-are-counted-never-attributed))                            | **Done.** Counted, never attributed.                                                                           |
| 5   | PWA install + push notification for "your turn"                                                                          | Not started. Push needs VAPID keys and a service worker.                                                       |
| 6   | Internationalisation                                                                                                     | Not started. The copy layer is centralised for it; the work is volume, not design.                             |
| 7   | `@socket.io/postgres-adapter` for multi-instance scale-out                                                               | Not started, and not needed: the deployment target is one instance.                                            |

The roadmap said group-custom themes were "already supported by the schema, needs only UI". That
was optimistic — `themes` carried `is_system` but no owning group, so it took a migration, a
partial unique index, and moving the theme routes under `/groups/:id` to stop one group's prompts
reaching another's picker.

---

## Sequencing rationale

The domain engine (Phase 5) lands **before** the API that uses it, so the hardest logic in the
product is proven correct in isolation while it is still cheap to change. Auth and authorization
(Phases 2–3) land before anything they protect, so no feature is ever built on an unguarded
route. The frontend shell (Phase 7) precedes the game screens so the game is built on a finished
design system rather than retrofitted into one.

Total to a shippable v1: roughly **35 focused engineer-days**, Phases 0–9.

## Definition of done, every phase

- [ ] Lint, typecheck, unit and integration tests pass in CI
- [ ] New rules covered by tests, including at least one failure case
- [ ] Public functions documented with TSDoc; non-obvious decisions commented with _why_
- [ ] No new `any`, no `@ts-expect-error` without a linked issue
- [ ] Error paths return typed `AppError`s with client-mapped copy
- [ ] New environment variables added to the Zod schema, `.env.example` and [09](09-deployment.md)
- [ ] Anonymity regression suite still green
