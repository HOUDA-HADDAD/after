# Application audit — 27 September 2026

## Scope and architecture

Reviewed the Aftergame workspace: React 19/Vite/Tailwind client, TanStack Query, shared Zod
contracts, Fastify HTTP API, Socket.IO notifications, Prisma/PostgreSQL, migrations, seed,
authorization policies, authentication, invitations, memberships, game projections, tests,
environment validation and deployment files. Unrelated untracked `QuadLock/` and
`hamid-dashboard/` projects were excluded. No production database or deployed host was accessed.

The existing flow remains: form → shared validation → same-origin HTTP → mandatory route policy
and session resolution → service authorization/business rules → repository/transaction → DTO →
room-scoped query cache. Socket events request refetches; they do not carry private game content.
No framework, authentication system, database, UI library or infrastructure service was added.

## A. Root causes

### Room codes

Creation persisted the group and owner membership, but **never created its invitation**.
The room-code component returned early when no code existed, also hiding the generation button.
Existing rooms with invitations worked; newly created rooms could remain permanently codeless in
the UI. There was no first-room singleton or shared query-key collision. The historical reason
the reported first room already had a code cannot be established without its database history.

The service now generates a cryptographically random code and creates group, owner and invitation
atomically through the existing repository. Database uniqueness remains authoritative; bounded
collision retries cannot leave orphan rooms. Existing codeless rooms can generate a code normally.
No migration or speculative data backfill is required.

Regeneration previously appended an invitation, although `05-user-flows.md` promises replacement.
The implementation now follows that specification: under a group row lock, revoke old codes and
create the replacement in one transaction. Failure preserves the old code. Redemption locks the
same group, rechecks validity and capacity, and avoids duplicate membership/use counts. Expired,
revoked and exhausted codes all return the same unusable-code error, including for existing members.

### Login attempts

The route's five-request IP budget counted **successful sign-ins** and did not reset. Five valid
sign-ins followed by one wrong password reproduced an immediate 429. The account service had a
separate ten-attempt budget and correctly reset on success. Fetch and TanStack mutation retries
were not duplicating requests, and the form did not have two independent submit handlers.

The credential service now reserves one IP/account attempt per accepted login request before
asynchronous verification, then resets both budgets on success. The original failure thresholds
remain: five/IP/15 minutes and ten/email/hour. The broad HTTP flood limit remains. The form also
uses a synchronous in-flight guard to reject duplicate submission events before React rerenders.
Malformed requests and flood-budget rejection are separate from password verification.

### Other significant findings

- Existing sockets could keep receiving activity notifications after logout, expiry or removal.
  Delivery and subscriptions now recheck the session and resource access; foreign-origin
  handshakes are rejected and malformed cookies cannot throw out of parsing.
- Concurrent membership/ownership changes used permissions read before the transaction.
  Group locks and permission rechecks serialize those mutations.
- Query data survived account changes; failed network logout could falsely show a signed-out UI.
  Cache clearing follows confirmed authentication transitions; logout failure keeps the session UI.
- Malformed resource UUIDs could reach Prisma and become server errors. Route parameters now
  fail validation before database access.
- Production trusted arbitrary forwarding chains. Trust is limited to one proxy hop.
- HTML could inherit immutable asset caching. HTML now revalidates; hashed assets stay immutable.
- Built-in icon identifiers were rendered as English text. Existing Lucide icons now render them;
  custom emoji remain intact. The copied-code indicator resets when the invitation changes.

## B. Important files changed

Paths below are relative to the repository root.

| Files                                                                                                                                  | Purpose                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/groups/groups.{service,repository,routes}.ts`                                                                    | Atomic group/invitation creation, collision recovery, group lock, generation throttle         |
| `apps/api/src/modules/invitations/invitations.{service,repository}.ts`                                                                 | Transactional replacement/redemption, capacity, active filtering, account guess budget        |
| `apps/api/src/modules/auth/auth.{service,repository,routes}.ts`, `plugins/auth.ts`                                                     | Failure budgets, successful reset, renewal after logout race                                  |
| `apps/api/src/modules/memberships/memberships.service.ts`                                                                              | Serialized role/removal/leave/ownership checks                                                |
| `apps/api/src/realtime/server.ts`                                                                                                      | Handshake origin/session checks, delivery reauthorization, subscription budget                |
| `apps/api/src/app.ts`, `plugins/{security,route-policy,error-handler,prisma,request-context,static}.ts`                                | Proxy trust, cross-site checks, UUID validation, safer request/database errors, cache headers |
| `apps/api/src/modules/themes/system-themes.ts`                                                                                         | French built-in names, descriptions and prompts; existing seed upserts update them            |
| `apps/web/src/features/auth/{LoginPage,SessionProvider}.tsx`                                                                           | Duplicate guard, cache isolation, honest logout state                                         |
| `apps/web/src/features/groups/{GroupsPage,GroupDetailPage,groups.api}.tsx/ts`, `lobby/{RoomCode,RoomHeader,ThemeGrid}.tsx`             | Creation navigation, scoped code actions, copy/revoke/status/expiry, owner display, icons     |
| `apps/web/src/shared/components/{AppShell,LanguageMenu,ThemeIcon}.tsx`, `features/game/components/ThemeBanner.tsx`                     | Logout feedback, fixed-language UI and icon rendering                                         |
| `apps/web/src/shared/i18n/{LocaleProvider,translations}.tsx/ts`, `app/router.tsx`, `index.html`, `features/game/hooks/useDictation.ts` | French production locale, notifications, metadata and dictation                               |
| `packages/shared/src/schemas/{auth,group,session,zod}.ts`                                                                              | French validation messages, including library defaults                                        |
| `apps/web/src/shared/realtime/SocketProvider.tsx`                                                                                      | Group subscription cleanup                                                                    |
| API regression/static/group tests; web auth/lobby tests; `e2e/specs/*`                                                                 | Security, concurrency, French flows, network request count, desktop/mobile coverage           |
| `package.json`, API/web manifests, `pnpm-lock.yaml`                                                                                    | Compatible Fastify/URI patches and narrowly scoped brace-expansion override                   |
| `docs/07-security.md`, this report, `dependency-audit.json`                                                                            | Correct actual controls, verification and remaining advisory                                  |

## C. Security findings

Severity reflects impact in this application; a package advisory rating is not proof of reachable
exploitation here.

### Critical

No critical vulnerability confirmed in this review. This is not a claim that none can exist.

### High

- Dependency audit initially reported 12 high and two moderate findings, including runtime
  URI-parser/brace-expansion denial-of-service advisories. Fastify is now 5.12.5, fast-uri is patched
  in its v3/v4 lines, and brace-expansion 5.0.8 is overridden to 5.0.12 without changing legacy
  ESLint dependency majors.
- **Open package advisory:** `GHSA-ggr8-5vv4-36mx`, deepmerge-ts 7.1.5 via Prisma 6 configuration,
  upstream severity high. Final production audit reports one high, zero moderate/critical.
  Exploitation requires recursive JavaScript object graphs; plain HTTP JSON cannot represent
  them. No untrusted configuration merge path was found in this application. Fix requires a
  major dependency transition; no unsupported override or suppression was added. Reassess when
  upgrading Prisma. Full details and dependency path are in `dependency-audit.json`.

### Medium

- Stale socket authorization exposed activity metadata after revocation; fixed and tested with
  real sockets for logout, expiry and membership removal. Private content still used HTTP checks.
- Concurrent invitation/member updates could violate intended access/ownership/capacity rules;
  relevant transactions now lock and recheck, with collision and parallel-request regressions.
- Overly broad proxy trust could permit IP-budget evasion in unsafe forwarding topologies; fixed
  for the documented single Caddy hop. Direct API exposure or additional proxies require review.
- Missing account-based invitation throttling allowed one account to spread guesses across IPs;
  the service now enforces ten/hour in addition to the route IP budget.
- Cached data across account changes and false logout success were privacy/session-state risks;
  caches are cleared and logout awaits server confirmation.

### Low

- UUID errors and raw request/database error details unnecessarily exposed implementation data or
  noisy errors; request validation and generic logging/field errors reduce that exposure.
- Incorrect HTML caching could preserve old UI/code behavior across releases; fixed and tested.
- Missing generation action, clipboard error feedback, owner/status information, and mixed-language
  validation harmed usability; fixed without a redesign.

### Informational / verified existing controls

- Argon2id password verification, dummy verification for unknown emails, opaque 256-bit tokens,
  SHA-256 token hashes at rest, production HttpOnly/Secure/SameSite=Lax `__Host-` cookies,
  expiry and server-side logout remain. Successful logins issue fresh random tokens.
- Route-policy enforcement is fail-closed at boot. Membership/role/resource checks and anonymous
  response projections are covered by authorization and 27 anonymity regression tests.
- ORM queries and tagged raw SQL bind values. No unsafe dynamic SQL or raw HTML rendering was
  found in application sources. React escapes user text. No JWT, uploads, NoSQL, password reset
  or password-change flow exists; these were not invented for the audit.
- Same-origin deployment and Vite proxy remain. No permissive CORS was added. Foreign Origin and
  cross-site Fetch Metadata are rejected; missing Origin remains permitted for non-browser clients.
- Registration intentionally identifies taken email/usernames under decision D17a; this is known
  enumeration behavior, not an overlooked login-message leak.
- Secret-pattern checks and tracked environment/history path checks found no exposed secret in
  their scope. A full forensic secret-history scan or credential rotation was not performed.

## D. Tests executed

Environment: Windows, Node 24.18.0, pinned pnpm 9.15.9 via npm exec, embedded PostgreSQL 16.14,
Chromium desktop and Pixel 5 emulation. Tests use isolated temporary databases, not production.

| Command (repository root unless noted)                                             | Result                                                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm exec --yes --package=pnpm@9.15.9 -- pnpm exec turbo run typecheck test build` | 18/18 tasks successful; 10 reused verified local cache entries                               |
| Included API Vitest                                                                | 19 files, 356 tests passed                                                                   |
| Included frontend component Vitest                                                 | 11 files, 140 tests passed                                                                   |
| Included frontend real-API full-game Vitest                                        | 1 file, 15 tests passed                                                                      |
| Included shared/config/game-core/ESLint-rule tests                                 | 29 + 11 + 121 + 25 = 186 passed; game-core 100% measured coverage                            |
| `node node_modules/typescript/bin/tsc --noEmit -p e2e/tsconfig.json`               | Passed                                                                                       |
| `node node_modules/eslint/bin/eslint.js apps packages e2e eslint.config.mjs`       | Passed with installed dependencies readable                                                  |
| `node node_modules/@playwright/test/cli.js test --config e2e/playwright.config.ts` | Initial full desktop/mobile run: 48 passed, 3 test failures, 1 intentional desktop-only skip |
| Same Playwright command with `room-codes.spec.ts punishment.spec.ts`               | After selector/response-shape/request-wait fixes: all 10 passed on both devices              |
| `npm exec --yes --package=pnpm@9.15.9 -- pnpm audit --prod --json`                 | Exit 1: one remaining high Prisma configuration advisory; saved output                       |

The three browser failures were an ambiguous heading selector, a test assuming a bare invitation
array instead of `{ invitations }`, and reloading before the forgiveness POST completed. Earlier
runs also caught obsolete English selectors and static-header/proxy typing errors; these were
fixed. Sandbox-only lint/type resolution failures were rerun successfully with dependency access.
Do not interpret failed intermediate checks as passing checks.

Final post-visual-polish verification:

- `npm exec --yes --package=pnpm@9.15.9 -- pnpm --filter @aftergame/web run build`: passed.
- Frontend and E2E `tsc --noEmit` commands: passed; scoped ESLint command above: passed again.
- From `apps/web`, `node node_modules/vitest/vitest.mjs run tests/lobby.test.tsx tests/game.test.tsx`:
  25 lobby tests passed. There is no matching `tests/game.test.tsx`; this command does not establish
  a second component suite. Game behavior is covered by the full-game and browser suites above.
- Full Playwright command above, rerun against the final build: **51 passed, one intentional skip**
  (mobile drawer check on desktop), zero failures. Includes desktop/mobile French flows, code
  lifecycle, real login requests, light/dark accessibility, CSP and reconnection.
- Prettier `--check` over changed/new audit files: passed. `git diff --check`: passed.
- Desktop and mobile room screenshots were inspected; theme identifiers now render as icons and
  the copied indicator no longer persists onto a newly generated code.

Total distinct passing workspace tests: **697**, plus **51 browser cases**. Component tests emit
existing non-failing `act()`/unmatched test-router warnings; Vite emits the chunk-size warning below.

## E. Remaining limits and deployment work

- One production dependency advisory remains as described above; the audit gate is not green.
- Docker is unavailable here. Container build/startup, actual HTTPS termination/cookies, hosted
  database TLS, backup restoration and operational alerting are unverified. Production-mode
  header/cookie integration tests and browser CSP tests are not substitutes for those checks.
- The supplied Compose stack shares a database credential for runtime and migrations; it does
  not enforce the least-privilege separation formerly claimed in the security document. Remote
  database TLS must be configured by the operator. Database/proxy logs need their own privacy
  and retention review; Pino redaction does not control PostgreSQL server logs.
- Attempt budgets are in memory, bounded to 10,000 keys, reset on process restart, and local to
  one instance. Multiple instances or large-scale distributed abuse need shared enforcement.
  Content writes currently use the general 300/IP/minute budget, not the undocumented separate
  30/user/minute budget. No large-scale load or external penetration test was performed.
- Socket reauthorization adds database work per recipient/event. Existing behavior passes tests,
  but high-volume fan-out was not benchmarked. Revocation is checked before future delivery;
  it cannot recall a response/event already authorized and in flight.
- Vite reports an approximately 854 kB minified JS chunk (236 kB gzip). Builds pass; code splitting
  is a performance follow-up, not part of the room/authentication correction.
- Product limitations remain: registration enumeration, no email verification/recovery, trusted
  database administrators can read live content, writing style may identify a player, and two-person
  unanimous-reveal voting inherently identifies a dissenting player. See the specification.
- French applies to application-owned UI, validation and built-in seed content. User-authored
  room names, themes and messages retain their original language. Existing databases receive
  updated built-in wording when the normal idempotent startup seed runs.

## F. Architecture impact

Frontend state management, query-key scheme, design system and translation infrastructure remain.
The production router fixes the locale to French; English dictionaries remain for typed keys and
existing component tests, with no production language switch. Backend changes remain in route,
service and repository layers. Opaque sessions and role semantics remain. No schema migration,
new API shape, JWT, Redis, CORS service or deployment provider was introduced. Invitations now
follow the documented replacement behavior. Deployment requires one trusted proxy hop.

## G. Verification conclusion

Three rooms get distinct persisted codes and redeem into their corresponding rooms, including
concurrent creation. The tests cover invalid/expired/revoked/exhausted codes, replacement rollback,
capacity and duplicate joins. Login tests prove a single request consumes one attempt, successful
login resets budgets, and concurrent requests cannot bypass thresholds. Permission and security
regressions, French game flows and moderate UI improvements are verified within the test scope.

This review does **not** certify complete security or production readiness while the dependency
advisory and deployment checks above remain open.
