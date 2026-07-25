# Aftergame

An anonymous social party game for private groups of friends.

Groups are permanent. Games are not. Inside a group, a host opens a temporary session
with a single theme, everyone writes one anonymous text, texts are randomly redistributed,
players answer, the table talks — and only at the very end, only if you asked for it,
do you find out who wrote what.

> **Status: Phase 3 of 10 complete.** You can register, sign in, create a private group, invite
> friends with a room code, and manage roles — with the authorization matrix enforced and tested.
> The punishment system is next. See the [roadmap](docs/06-roadmap.md), and read the design
> documents below in order.

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

Full instructions, including the Docker-optional path, are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Cost

Zero. PostgreSQL, Node, and every library chosen is open source and self-hostable. There
are no paid APIs anywhere in the design — dictation uses the browser's built-in Web Speech
API and spellcheck uses the browser's native spellchecker.
