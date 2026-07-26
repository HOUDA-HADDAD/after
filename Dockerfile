# syntax=docker/dockerfile:1.7
#
# One image: the API serving the built client from a single origin.
#
# Three stages, for three different reasons. `deps` installs with the lockfile so the layer is
# cached until the lockfile changes. `build` compiles both apps and then prunes to production
# dependencies, so nothing that only mattered at build time can end up in the image. `runtime`
# starts from a clean base and copies only what runs.
#
# `pnpm docker:check` builds this file and boots the image against a throwaway PostgreSQL. It has
# not been run on the machine this was written on — Docker is not available there — so the paths
# below are verified statically (every COPY source is checked to exist) and the build itself is
# the first thing to run on a machine that has Docker. Said plainly in docs/09-deployment.md too.

ARG NODE_VERSION=22.22.1

# ---- deps ---------------------------------------------------------------------------------- #

FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo

# Only the manifests, so a source-only change does not re-resolve the dependency graph.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/game-core/package.json packages/game-core/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/eslint-rules/package.json packages/eslint-rules/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build --------------------------------------------------------------------------------- #

FROM deps AS build
WORKDIR /repo

COPY . .

# `prisma generate` runs inside the API build, so the client matches the schema in this image.
RUN pnpm build

# Reinstall with dev dependencies removed. `--frozen-lockfile` keeps this honest: it fails rather
# than quietly resolving something new at the last moment.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- runtime ------------------------------------------------------------------------------- #

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# openssl is Prisma's runtime requirement on Debian; tini reaps zombies and forwards signals, so
# `docker stop` reaches Fastify's shutdown hook instead of killing pid 1 outright.
RUN apt-get update \
    && apt-get install --no-install-recommends -y openssl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# `node` exists in the base image with uid 1000. Running as root inside a container is a habit
# worth not having, and nothing here needs it.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml

COPY --from=build --chown=node:node /repo/packages ./packages
COPY --from=build --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /repo/apps/api/scripts ./apps/api/scripts
COPY --from=build --chown=node:node /repo/apps/web/dist ./apps/web/dist

USER node
WORKDIR /repo/apps/api

EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0

# The container is healthy when the app says it is ready — which includes the database, so an
# orchestrator will not send traffic to a process that cannot answer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]

# Migrations run before the server starts, with the direct (unpooled) connection — see
# docs/09-deployment.md for why that distinction matters on serverless PostgreSQL.
CMD ["sh", "-c", "node scripts/prisma.mjs migrate deploy && node dist/main.js"]
