# 08 — Testing strategy

Coverage percentages are a weak signal. What follows is organised by _what could actually go
wrong in this product_, and each layer is chosen because it catches a class of failure the layers
around it cannot.

```
        ╱ E2E — Playwright, multi-context real games        (~15 specs)
      ╱   Integration — Fastify + real PostgreSQL            (~120 tests)
    ╱     Property — fast-check over game-core               (~15 properties, 10k+ cases)
  ╱       Unit — pure functions, mappers, policies           (~250 tests)
╱         Static — TypeScript strict, ESLint custom rules    (every file)
```

---

## Static layer

Strict TypeScript with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, plus three
custom ESLint rules that turn our architectural invariants into build failures:

| Rule                             | Catches                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| `no-prisma-outside-repositories` | Business logic reaching into the database directly                     |
| `no-imports-in-game-core`        | The domain package acquiring I/O and becoming untestable               |
| `no-identity-fields-in-dto`      | `authorId` / `revealVote` / `choice` appearing in any serialized shape |

The third rule is a security control, not a style preference.

## Unit tests — Vitest

Fast, no I/O, run on every save.

- **`game-core`** — every branch of punishment arithmetic, phase guards, visibility rules.
  **100% branch coverage on this package is enforced in CI**, because it is small, pure, and
  contains every rule that matters.
- **Policies** — the authorization matrix: for each of the ~25 actions, every role
  (owner / co-host / member / non-member / blocked) × own-resource vs other-resource. Table-driven,
  so a new action without a policy row fails immediately.
- **Mappers** — entity → DTO, asserting the _absence_ of identity fields per phase.
- **Utilities** — token generation and hashing, invitation-code alphabet, character limits.

## Property tests — fast-check

The distribution algorithm is randomised, so example-based tests prove nothing about it.
Properties, run over generated `N ∈ [2, 40]` and random punishment level vectors:

| Property | Assertion                                                                             |
| -------- | ------------------------------------------------------------------------------------- |
| **P1**   | every player receives exactly `demand(p)` texts _(I1)_                                |
| **P2**   | no player receives the same text twice _(I2)_                                         |
| **P3**   | every text is assigned at least once _(I3)_                                           |
| **P4**   | text usage is balanced within one of `⌊S/N⌋` / `⌈S/N⌉` _(I4)_                         |
| **P5**   | zero self-assignments whenever `N ≥ 3` and every `d(p) ≤ N−1` _(I5)_                  |
| **P6**   | the same seed always produces byte-identical assignments                              |
| **P7**   | different seeds produce different assignments for `N ≥ 4` (no accidental determinism) |
| **P8**   | `distribute` never throws for any feasible input, and never returns a partial result  |
| **P9**   | punishment: any punish-then-complete-unpunished sequence lands back at level 0        |
| **P10**  | phases: no sequence of legal transitions ever reaches an illegal state                |

Failing cases are shrunk automatically and pinned as regression tests. This is the single
highest-leverage test investment in the project — the distribution algorithm is the one place
where a subtle bug silently ruins games without throwing an error.

## Integration tests — Vitest + real PostgreSQL

The API is exercised through `app.inject()`, so routes, plugins, validation, authorization and
transactions all execute for real against a real database.

**Two tiers, both genuine PostgreSQL 16:**

| Tier | When                       | What it is                                                                                                                                                                               |
| ---- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `TEST_DATABASE_URL` is set | An already-running PostgreSQL. CI uses a Postgres 16 service container; locally `docker compose up -d` creates `aftergame_test` for this.                                                |
| 2    | Otherwise                  | The official PostgreSQL 16 binaries shipped via npm (`embedded-postgres`), started on a temporary data directory and deleted on teardown. No Docker, no admin rights, no global install. |

Migrations are applied by `prisma migrate deploy` — the exact command production runs — so the
suite verifies the real migration path rather than a test-only schema shortcut. Both tiers are
initialised `UTF8` / `C` collation to match production exactly; a locale-inherited database
behaves differently enough to make a green run meaningless.

Between tests the database is emptied with `TRUNCATE … CASCADE` rather than a per-test
transaction rollback, because the code under test opens its own transactions and wrapping those
in an outer one changes the very isolation behaviour the session tests exist to verify.
Factories (`makeUser`, `makeGroup`, `makeAnswerableSession`) keep setup to a couple of lines.

> **Why not Testcontainers, and why not an in-process WASM PostgreSQL?**
> Testcontainers requires a working Docker daemon, which is one more thing that must be true
> before anyone can run a test; tier 1 already covers Docker users through plain compose, and
> tier 2 removes the requirement entirely. An in-process WASM build (PGlite) was tried first and
> rejected: its socket bridge desynchronised after the first constraint violation, reporting
> later failures as successes. More than half of this suite asserts that constraints _reject_
> bad data, so a harness that gets error paths wrong is worse than no harness at all.

Coverage areas:

- **Auth** — full lifecycle; token hashed at rest; sessions revoked on logout and password change;
  timing parity between known and unknown emails.
- **Groups & membership** — the role matrix; non-members get 404 for every route; the owner
  cannot leave; ownership transfer; the single-owner partial index.
- **Invitations** — expiry, revocation, use caps, uniform errors, rate limits.
- **Punishments** — 0→1→2→3, forgiveness, group independence, audit rows, the unpunished reset.
- **Session lifecycle** — full games at `N = 2, 3, 8` with and without punishment; force-advance;
  cancel; abandon; the grace-window purge.
- **Constraints** — each database constraint is proven to actually reject bad data: duplicate
  `(text_id, receiver_player_id)`, two live sessions in one group, blank bodies, punishment level
  4, two owners, level 3 disagreeing with `GAME_BLOCKED`.
- **Hand-written DDL** — extensions, `uuid_generate_v7()`, the partial unique indexes and every
  CHECK constraint are asserted present _by name_. Prisma's schema language cannot express any of
  them, so `prisma migrate dev` cannot see them and a generated migration will happily drop them.
  This block is the alarm; if it goes red after a migration, the generated SQL needs its DROP
  statements removed before it is committed.
- **Purge cascade** — deleting one `game_sessions` row removes every text, assignment, answer,
  comment, guess and vote, destroys the `game_players` mapping back to real accounts, and leaves
  the punishment audit standing with its session reference nulled (D11).
- **Concurrency** — 20 parallel "final submit" requests produce exactly one distribution; parallel
  punish calls do not skip a level; double-submit is idempotent.
- **Real-time** — a genuine Socket.IO client connects, is rejected without a cookie, is rejected
  joining a room for a group it does not belong to, and receives correctly _projected_ payloads.

## Anonymity regression suite

Its own directory, its own CI job, and treated as a release blocker. It asserts on **serialized
output** — the actual JSON and the actual WebSocket frames — not on internal objects, because a
leak is defined by what crosses the wire.

| #   | Assertion                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | No text/answer payload contains any user identifier in `WRITING`, `ANSWERING` or `REVIEW`, for any role including owner                                                                                            |
| A2  | Anonymous comments never contain an author identifier, in any phase, ever — including after reveal                                                                                                                 |
| A3  | The reveal-vote _split_ appears in no response, no event and no log line; only `decided / total`                                                                                                                   |
| A4  | If **any** participant votes NO or abstains, no participant — including those who voted YES — receives identities; the `COMPLETED` timeline is byte-equivalent in identity terms to the `REVIEW` one, for everyone |
| A5  | When reveal succeeds, identities appear only after the vote closes, never before, and identically for every participant                                                                                            |
| A6  | Guess correctness and the leaderboard are absent for everyone unless reveal succeeded                                                                                                                              |
| A7  | Timeline order is a function of `display_seed`, and differs from submission order for `N ≥ 4`                                                                                                                      |
| A8  | Progress events contain counts only, never names or ids                                                                                                                                                            |
| A9  | No response ever exposes the text→receiver assignment map                                                                                                                                                          |
| A10 | No log line, at any level, contains text/answer/comment content                                                                                                                                                    |
| A11 | WebSocket payloads pass A1–A9 identically to their REST equivalents                                                                                                                                                |

A5 and A11 are the ones that would realistically regress during refactoring, which is exactly why
they are pinned.

## End-to-end — Playwright

Three browser contexts in one test act as three players, driving real WebSocket traffic.

| Spec | Scenario                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| E1   | Register → create group → invite → join → full 3-player Questions game → timeline                                    |
| E2   | Full Anecdotes game with comments and author guessing                                                                |
| E3   | Punishment: host punishes a player, who then receives two answer cards                                               |
| E4   | Reveal outcomes — unanimous YES reveals for all; one NO (and one abstention) hides for all, including the YES voters |
| E5   | Disconnect mid-writing, reconnect, draft preserved, game resumes                                                     |
| E6   | Force-advance with an absent player; timeline shows "no answer"                                                      |
| E7   | Blocked player cannot join; forgiveness restores access                                                              |
| E8   | Second-game-while-live is blocked with a link to the live game                                                       |
| E9   | Empty submit is refused with a visible warning                                                                       |
| E10  | Mobile viewport: complete game at 390×844                                                                            |
| E11  | Dark mode + `prefers-reduced-motion` render correctly                                                                |
| E12  | Purge: after the grace window a finished game returns the friendly gone-screen                                       |
| E13  | Keyboard-only path through a full game                                                                               |
| E14  | axe accessibility scan on every major route                                                                          |
| E15  | Firefox: dictation button absent, everything else works                                                              |

## Non-functional checks

- **Accessibility** — `@axe-core/playwright` on every route, zero violations at WCAG 2.1 AA;
  manual keyboard and screen-reader pass before release.
- **Performance** — `autocannon` against the timeline and answer-submit endpoints; every hot query
  reviewed with `EXPLAIN ANALYZE` against a seeded 10k-row database. Budget: p95 < 150 ms on the
  timeline read.
- **Bundle** — `rollup-plugin-visualizer` in CI with a size budget; route-level code splitting.
- **Load sanity** — a simulated 30-player game to confirm distribution and fan-out stay
  comfortable.

## CI pipeline

```
push / PR
  ├── install (pnpm, frozen lockfile, cached)
  ├── lint + typecheck            ← Turborepo cached
  ├── unit + property             ← game-core coverage gate: 100% branches
  ├── integration (Postgres 16 service)
  ├── anonymity regression        ← separate job, release blocker
  ├── build (api + web)
  ├── e2e (Playwright, built artifacts)
  └── security: pnpm audit · licence allowlist · gitleaks
```

Merges to `main` require every job green. GitHub Actions is free for public repositories.

## What we do not test

Stated so the gaps are deliberate rather than accidental: no visual-regression snapshots (high
churn, low value at this stage — replaced by axe plus manual review); no mutation testing outside
`game-core` (worth revisiting for `visibility.ts` specifically); no third-party service mocks,
because there are no third-party services.
