# Contributing

## Getting set up

Prerequisites: **Node 22+** and **pnpm 9+**. Docker is convenient but **optional** — see below.

```bash
pnpm install
cp .env.example .env
docker compose up -d          # PostgreSQL 16 + Adminer on :8080
pnpm --filter @aftergame/api db:migrate
pnpm --filter @aftergame/api db:seed
pnpm dev
```

`pnpm dev` starts the API on `http://localhost:3000` and the web client on
`http://localhost:5173`. The Vite dev server proxies `/api`, `/healthz`, `/readyz` and
`/socket.io` to the API, so the browser sees a **single origin** in development exactly as it
will in production. Cookie, CSRF and WebSocket behaviour is therefore identical in both — please
do not "fix" a problem by bypassing the proxy.

If you do not have pnpm:

```bash
npm install -g pnpm@9
```

### If port 5173 or 3000 is already taken

Set `WEB_PORT` or `PORT` in `.env` — **and change `APP_ORIGIN` to match the web port**. The dev
server refuses to fall back to a random port on purpose: a silently different origin would make
the CSRF check reject every write with a confusing 403, which is a far worse afternoon than a
one-line edit.

```bash
WEB_PORT=5273
APP_ORIGIN=http://localhost:5273
```

## Everyday commands

| Command                             | What it does                 |
| ----------------------------------- | ---------------------------- |
| `pnpm dev`                          | API + web in watch mode      |
| `pnpm test`                         | Unit and integration tests   |
| `pnpm test:watch`                   | Same, in watch mode          |
| `pnpm lint` / `pnpm lint:fix`       | ESLint across the workspace  |
| `pnpm typecheck`                    | `tsc --noEmit` everywhere    |
| `pnpm format` / `pnpm format:check` | Prettier                     |
| `pnpm build`                        | Build every package and app  |
| `pnpm verify`                       | Everything CI runs, in order |

Run `pnpm verify` before opening a PR. It is the same set of gates CI applies, so a green local
run means a green pipeline.

### Database commands

Run from `apps/api`, or prefix with `pnpm --filter @aftergame/api`:

| Command      | What it does                                                         |
| ------------ | -------------------------------------------------------------------- |
| `db:migrate` | `prisma migrate dev` — create and apply a migration in development   |
| `db:deploy`  | `prisma migrate deploy` — apply pending migrations, as in production |
| `db:seed`    | Insert the three system themes; idempotent, safe to re-run           |
| `db:studio`  | Prisma Studio, a browser UI over the data                            |
| `db:reset`   | Drop, re-migrate and re-seed. Destroys local data.                   |

**The test suite needs no database setup.** If `TEST_DATABASE_URL` is set it uses that PostgreSQL
(`docker compose up -d` creates `aftergame_test` for it); otherwise it starts its own PostgreSQL
16 for the run and deletes it afterwards. Setting the variable skips a ~3s boot per run.

### Careful with `prisma migrate dev`

Some of the schema is hand-written SQL that Prisma's schema language cannot express: the `citext`
and `pgcrypto` extensions, `uuid_generate_v7()`, two partial unique indexes, and eleven CHECK
constraints. Prisma cannot see them, so **a generated migration will contain statements dropping
them**. Read every generated migration and delete those DROPs before committing.

The `hand-written DDL is present` block in `tests/integration/schema-constraints.test.ts` is the
alarm for this. If it goes red, that is what happened.

## Repository layout

```
apps/api        Fastify server — HTTP, WebSocket, scheduled jobs
apps/web        React SPA
packages/game-core      pure domain rules — no dependencies at all (from Phase 5)
packages/shared         contracts shared by client and server
packages/config         environment schema, validated at boot
packages/eslint-rules   project-specific lint rules
docs/           architecture, schema, flows, roadmap — read docs/00 first
```

`docs/04-modules.md` explains the conventions each module follows.

## The rules that are not negotiable

These are enforced by lint, tests or CI, so you will find out quickly — but knowing why saves time.

1. **`packages/game-core` has no dependencies.** No imports except relative ones, no `Date.now()`,
   no `Math.random()`. Time and randomness are parameters. This is what makes the game rules
   exhaustively testable.
2. **Identity never leaves the server unless the viewer is entitled to it.** Author ids are
   stripped server-side, never hidden in the client. Every payload goes through the projection in
   `game-core/visibility.ts`. Anonymity is the product — see `docs/07-security.md`.
3. **Never log game content.** Texts, answers and comments do not belong in a log line at any
   level. Log ids, phases and error codes.
4. **Prisma only inside repositories.** Services call repositories; they do not build queries.
5. **Every route declares an authorization policy.** A meta-test fails the build if one does not.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sessions): lock the roster when a game starts
fix(auth): reject expired session tokens
docs(schema): explain the assignment uniqueness constraint
test(distribution): cover the two-player clamp
chore(deps): bump fastify to 5.2.1
```

Scopes match module names (`auth`, `groups`, `sessions`, `distribution`, `web`, `deps`, …). Write
the subject in the imperative, and keep the _why_ in the body — the diff already shows the what.

## Pull requests

- One phase deliverable, or one coherent change, per PR.
- Fill in the template, including the **Anonymity impact** section. "None" is a valid answer; an
  empty section is not.
- UI changes need screenshots in light and dark, at mobile and desktop widths.
- New behaviour needs a test that fails without the change.

## Adding a dependency

Ask first whether it earns its place. If it does:

- it must be MIT / ISC / Apache-2.0 / BSD / PostgreSQL licensed (CI enforces this);
- it must be free and self-hostable, with no paid tier required — the project promises this;
- add it to the specific workspace package that uses it, never to the root;
- note the reasoning in `docs/02-tech-stack.md` if it is a significant choice.

## Where design decisions live

Behaviour that surprises you is probably deliberate and probably documented:

- `docs/00-spec-decisions.md` — every ambiguity in the brief and how it was resolved
- `docs/01-architecture.md` — layering, the anonymity boundary, the distribution algorithm
- `docs/07-security.md` — the threat model

If you disagree with a decision, change the document in the same PR as the code. A doc that
quietly stops being true is worse than no doc.
