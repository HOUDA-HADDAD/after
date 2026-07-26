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

Type-only imports are exempt from the first rule and test files from the second: a type cannot
build a query, and property tests are the thing that makes the pure package worth having.

`packages/game-core` additionally sets `"types": []` in its tsconfig, so it cannot even see
Node's globals — which is what stops `process.env` or a timer creeping into a supposedly pure
rule.

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
| **P5b**  | self-assignments equal the number the demands force, in _every_ shape _(I5, exact)_   |
| **P6**   | the same seed always produces byte-identical assignments                              |
| **P7**   | different seeds produce different assignments for `N ≥ 4` (no accidental determinism) |
| **P8**   | `distribute` never throws for any feasible input, and never returns a partial result  |
| **P9**   | punishment: any punish-then-complete-unpunished sequence lands back at level 0        |
| **P10**  | phases: no sequence of legal transitions ever reaches an illegal state                |

Failing cases are shrunk automatically and pinned as regression tests. This is the single
highest-leverage test investment in the project — the distribution algorithm is the one place
where a subtle bug silently ruins games without throwing an error.

P5b was added after the full-game suite found the case P5 could not see: when one player is
_forced_ into a self-assignment, everyone else was being handed one too. P5 is stated over the
region where the answer is zero, so the mixed case fell between the property and the rule. The
lesson generalises — a property guarded by "whenever the easy conditions hold" tests the guard as
much as the code, and the interesting inputs are usually the ones the guard excludes.

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
| A12 | Reaction tallies carry counts and the viewer's own flag, never a reactor — and one player cannot remove another's ([D20](00-spec-decisions.md#d20-reactions-are-counted-never-attributed))                         |

A5 and A11 are the ones that would realistically regress during refactoring, which is exactly why
they are pinned.

## Component tests — Vitest + happy-dom + Testing Library

Frontend tests render the real component tree — real router, real query client, real socket
provider — and stub only the network at `fetch` and the transport at `io()`. Queries go by role
and accessible name, so a test that passes is also evidence the markup is reachable.

Two doubles are worth naming, because a lazier version of either would make a whole class of test
vacuous:

- **`matchMedia`** is implemented, not stubbed. happy-dom has none, and a stub answering `false`
  would make every breakpoint assertion pass without testing anything. Ours parses the query and
  notifies subscribers, so a test can change the viewport mid-test and assert the layout reflows.
- **The socket** is a double the test drives from the server side, not a spy. The reconnect
  contract — replay the room subscriptions, invalidate the cache — is ours rather than
  Socket.IO's, and it can only be observed by making the server say `connect` a second time.

### The two accessibility layers, and why there are two

axe runs at both levels, and the split is deliberate.

| Layer                 | Runs on         | Catches                                                      |
| --------------------- | --------------- | ------------------------------------------------------------ |
| Component (happy-dom) | every component | roles, names, labels, landmarks, ARIA wiring — fast, on save |
| E2E (Playwright, E14) | every route     | everything, including what needs a real rendering engine     |

Two rules are disabled **in the component layer only**, because happy-dom cannot evaluate them —
not because the app fails them:

- `color-contrast` needs computed styles, and happy-dom computes none.
- `aria-hidden-focus` needs real focusability. An open modal marks the background `aria-hidden`
  and `inert`; a browser then reports that subtree as unfocusable, but happy-dom does not
  implement `inert`, so axe sees an aria-hidden subtree full of focusable links. Radix's own
  focus-guard sentinels (`tabindex="0"` plus `aria-hidden`, by design) trip the same rule.

Leaving a rule enabled where it cannot be evaluated produces failures nobody can act on, and
teaches the team to ignore the report. Both are enforced for real in the Playwright pass, and the
behaviour they protect is asserted directly at the component level anyway: the drawer traps focus,
closes on Escape, restores focus to its trigger, and marks the background inert.

## The full-game suite — three players, one process

`apps/web/tests/e2e` plays complete games through the real screens. Nothing in it is a mock: the
Fastify app runs in the same process against a real PostgreSQL (the same two-tier helper the API
suite uses, migrated and seeded), and each player's `fetch` carries their own session cookie to
it. What the components render is what the projection actually produced for that viewer, so an
anonymity assertion here is a statement about the product rather than about a fixture written to
agree with it.

Players take turns rather than sharing a screen — which is how three phones work anyway, and buys
a second guarantee for free: every turn is a fresh mount reading the game back from the server, so
the flow doubles as proof that a player who closes the tab returns to exactly the phase the game
is in (F9). The three play at 320px, 768px and 1440px respectively, because three humans do not
share a device.

Two games are played: one that ends with a refusal, one that ends unanimously, since a single game
can only demonstrate one reveal outcome.

It runs under `pnpm test`, not behind a flag. A test that proves the product works and that nobody
runs is not a test.

**This is not a substitute for the browser pass below.** It exercises everything except a real
rendering engine and a real socket: layout, contrast, focus order under a real compositor, and
live multi-client traffic still need Playwright (Phase 9).

### What it found

The suite paid for itself on its first green run, with a bug three hundred property-test runs a
day had never surfaced. Distribution treated "may I have my own text?" as one decision for the
whole game: if any player was owed every text in play — a three-player game with someone on two
punishments does it — the constraint was dropped for _everyone_, and roughly two games in three
handed an unpunished player their own text back.

The invariant had been stated as "no self-assignment whenever every demand leaves an alternative",
and the property test asserted exactly that — so the mixed case, where one player is forced and
the others are not, sat precisely in the gap between the property and the rule it was standing in
for ([D4](00-spec-decisions.md#d4-a-player-may-receive-their-own-text--but-we-avoid-it-when-we-can)).
The fix makes self-assignment a per-unit last resort; the property now asserts the real rule — that
the number of self-assignments equals the number the demands force, in every shape — and fails
within fifty runs against the old code.

## End-to-end — Playwright

`e2e/` drives a real browser against the production topology: the **built** API serving the
**built** client from one origin, against a real PostgreSQL with the real migrations and seed.
Two projects — Desktop Chrome and a Pixel 5 — because "works on mobile" is the claim most easily
made and least often true.

Two differences from production, both deliberate and both stated in the harness itself:
`NODE_ENV=development` with `SERVE_STATIC=true`, because production insists on an https origin and
TLS is terminated by the proxy in front; and rate limiting off, because three players registering
and playing inside a minute is not a pattern the limits exist to allow. What that leaves uncovered
— HSTS, `Secure`, the `__Host-` prefix, and the strict CSP — is covered at the integration layer
instead, and the CSP is additionally executed in a browser by swapping the real production header
in (`csp.spec.ts`).

| Spec            | What only a browser can prove                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `smoke`         | The deployment shape itself: one origin, deep links, the API beside the client                   |
| `full-game`     | Three contexts at once; a socket carrying one player's submit into another's tab, with no reload |
| `resilience`    | A network genuinely taken away and given back; a closed tab; a host forcing the game on          |
| `punishment`    | The block explained rather than enforced by a missing button, and forgiveness restoring access   |
| `accessibility` | Contrast, `inert` and focus under a real compositor — **no rules disabled**                      |
| `csp`           | That the app actually runs under the policy production ships                                     |

### What it found

Three real defects, each invisible to every earlier layer:

- Links in prose were distinguished from surrounding text by colour alone (1.05:1 against a 3:1
  requirement) — they now carry a permanent underline.
- The accent badge measured 4.34:1 against a 4.5 requirement. The accent token moved three points
  darker, which improves every other use of it too.
- A finished game is long, scrollable, and — once the composers and guess buttons are gone —
  contains nothing focusable, so a keyboard user could not scroll it. The scroll container is now
  focusable.

Plus the two CSP defects described in [07](07-security.md), which would have shipped as "the
progress bar does not move" and "dark mode flashes white".

One harness note worth keeping: axe samples whatever colour an element has at the instant it runs,
so catching one mid-transition reports a blend of two states that nobody ever sees. Animations are
frozen by an init script, before the first paint, rather than by a stylesheet added afterwards —
which only ends a transition that has already started.

## Load and indexes

`pnpm perf` builds a game at the maximum the design allows — 30 players, a third of them on the
heaviest punishment load — then fires `autocannon` at the timeline read and runs
`EXPLAIN (ANALYZE, BUFFERS)` over every statement that read issued.

Measured on the development machine, against a 30-text, 48-answer, 160-comment game:

| Metric                  | Result | Budget   |
| ----------------------- | ------ | -------- |
| Requests/sec            | 401    | —        |
| Latency p50             | 48 ms  | —        |
| Latency p97.5           | 60 ms  | < 150 ms |
| Non-2xx                 | 0      | 0        |
| Seq scans over 200 rows | none   | none     |

The index review is automated rather than eyeballed: the script explains each statement and
reports any sequential scan on a table with more than 200 rows in it. A sequential scan over
thirty rows is the planner being right, not an index being missing.

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
  ├── full game (three players, real API + Postgres)
  ├── anonymity regression        ← separate job, release blocker
  ├── e2e (Playwright, built artefacts, desktop + mobile)
  ├── build (api + web)
  └── security: pnpm audit · licence allowlist · gitleaks
```

Merges to `main` require every job green. GitHub Actions is free for public repositories.

## What we do not test

Stated so the gaps are deliberate rather than accidental: no visual-regression snapshots (high
churn, low value at this stage — replaced by axe plus manual review); no mutation testing outside
`game-core` (worth revisiting for `visibility.ts` specifically); no third-party service mocks,
because there are no third-party services.
