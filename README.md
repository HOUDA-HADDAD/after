# Aftergame

An anonymous social party game for private groups of friends.

Groups are permanent. Games are not. Inside a group, a host opens a temporary session
with a single theme, everyone writes one anonymous text, texts are randomly redistributed,
players answer, the table talks — and only at the very end, only if you asked for it,
do you find out who wrote what.

> **Status: all ten phases delivered; Phase 10 continues.** Register, create a private group,
> invite friends, punish someone, write your own themes, start a game, write anonymously, answer
> the texts you are dealt, react to them, discuss them, guess who wrote what, and vote on whether
> to put names to any of it. The rules live in `@aftergame/game-core` (no dependencies, 100%
> branch coverage); an anonymity regression suite asserts on real serialized payloads; a full-game
> suite plays complete three-player games through the real screens against a real API and a real
> PostgreSQL; and a Playwright suite drives the built stack in a real browser on desktop and
> mobile with no accessibility rules disabled. Self-hosting is one `docker compose` away — see
> [deployment](docs/09-deployment.md). Phase 10 is an open backlog: password reset, per-phase
> timers, PWA and i18n are still on it ([roadmap](docs/06-roadmap.md)).

---

## Design documents

| #   | Document                                                  | What it answers                                                  |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| 00  | [Spec decisions & assumptions](docs/00-spec-decisions.md) | Every ambiguity in the brief, and the ruling we made             |
| 01  | [Architecture](docs/01-architecture.md)                   | System shape, layering, real-time design, the anonymity boundary |
| 02  | [Technology choices](docs/02-tech-stack.md)               | Every dependency and the reasoning behind it                     |
| 03  | [Database schema](docs/03-database-schema.md)             | Tables, relationships, indexes, cascade & purge behaviour        |
| 04  | [Modules & folder structure](docs/04-modules.md)          | How the code is organised, module by module                      |
| 05  | [User flows](docs/05-user-flows.md)                       | Screen-by-screen and edge-case behaviour                         |
| 06  | [Roadmap](docs/06-roadmap.md)                             | Ten delivery phases with exit criteria                           |
| 07  | [Security](docs/07-security.md)                           | Threat model and controls                                        |
| 08  | [Testing strategy](docs/08-testing.md)                    | Unit, property, integration, anonymity-regression, E2E           |
| 09  | [Deployment](docs/09-deployment.md)                       | Local dev, free production hosting, environment variables        |

## The one-paragraph summary

A pnpm monorepo. A React 19 + TypeScript SPA (Vite, Tailwind v4, shadcn/ui) talks to a
Fastify 5 + TypeScript API over a single origin, with Socket.IO for live game state and
comments, Prisma 6 over PostgreSQL 16 for persistence, and argon2id + opaque cookie
sessions for auth. All game rules — random distribution, punishment escalation, phase
transitions, and who is allowed to see whose name — live in a pure, dependency-free
`@aftergame/game-core` package that can be exhaustively property-tested without a database.
Everything runs free: `docker compose up` locally, and a no-cost hosting path in production.

## Running it

```bash
pnpm install && cp .env.example .env
pnpm dev
```

Tests need no database setup — they start their own PostgreSQL 16 if none is configured:

```bash
pnpm verify
```

The browser suite and the load check are separate, because both want the built app:

```bash
pnpm build && pnpm test:e2e
```

```bash
pnpm perf
```

Full instructions, including the Docker-optional path, are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Putting it online, free

Fifteen minutes, no card, a public HTTPS URL that works on any phone or laptop:

1. Push the repo to GitHub.
2. Create a free PostgreSQL at **neon.tech**, copy the direct connection string.
3. Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
4. On **render.com**, New → Web Service → your repo → runtime **Docker** → free instance, and set
   `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET`, and `APP_ORIGIN` to the URL Render
   gives you.
5. Open the URL and register.

Migrations and the default themes apply themselves on boot. The free instance sleeps after 15
minutes idle and takes about 50 seconds to wake, which is worth knowing before a party rather
than during one — [09](docs/09-deployment.md) has the full walkthrough, the always-on
self-hosted alternative, and what each trade-off actually costs.

## Cost

Zero. PostgreSQL, Node, and every library chosen is open source and self-hostable. There
are no paid APIs anywhere in the design — dictation uses the browser's built-in Web Speech
API and spellcheck uses the browser's native spellchecker.
