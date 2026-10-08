# syntax=docker/dockerfile:1.7
# Hector NestJS API — production image (multi-stage, non-root).
# Build from repository root:
#   docker build -f apps/api/Dockerfile --target runner -t hector-api:<sha> .

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.17.1

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# --- dependencies ---
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
# Hoisted linker so workspace transitive deps resolve inside the portable deploy tree.
RUN printf 'node-linker=hoisted\n' > .npmrc \
  && pnpm install --frozen-lockfile

# --- build ---
FROM deps AS build
COPY packages/database packages/database
COPY packages/config packages/config
COPY packages/types packages/types
COPY packages/validation packages/validation
COPY apps/api apps/api
# prisma.config.ts requires DATABASE_URL even for `prisma generate` (not used at runtime).
ENV DATABASE_URL=postgresql://build-time-only:unused@127.0.0.1:5432/build
RUN pnpm --filter @hector/database db:generate \
  && pnpm --filter @hector/database build \
  && pnpm --filter @hector/api build \
  && pnpm --filter @hector/api --prod deploy --legacy /deploy/api

# pnpm deploy may symlink workspace packages; materialize a real tree for the runner COPY.
RUN DB_PKG=/deploy/api/node_modules/@hector/database \
  && if [ -L "$DB_PKG" ]; then \
       TARGET="$(readlink -f "$DB_PKG")" \
       && rm "$DB_PKG" \
       && mkdir -p "$DB_PKG" \
       && cp -aL "$TARGET"/. "$DB_PKG"/; \
     fi \
  && test -f "$DB_PKG/dist/index.js" \
  && test -d /deploy/api/node_modules/@prisma/adapter-pg \
  && node -e "require('/deploy/api/node_modules/@prisma/adapter-pg'); require('/deploy/api/node_modules/@hector/database'); console.log('database deps ok')"

# --- migrator (one-off prisma migrate deploy; never seed/reset) ---
# Runs on the internal Docker network (no egress). Must not call Corepack/npm at runtime.
FROM build AS migrator
ENV NODE_ENV=production
ENV COREPACK_ENABLE_NETWORK=0
WORKDIR /app/packages/database
RUN groupadd --gid 10001 hector \
  && useradd --uid 10001 --gid hector --shell /usr/sbin/nologin --create-home hector \
  && chown -R hector:hector /app \
  && (test -x /app/packages/database/node_modules/.bin/prisma \
      || test -x /app/node_modules/.bin/prisma) \
  && if [ -x /app/packages/database/node_modules/.bin/prisma ]; then \
       ln -sfn /app/packages/database/node_modules/.bin/prisma /usr/local/bin/hector-prisma; \
     else \
       # Hoisted install: invoke via pnpm from package cwd (offline; COREPACK_ENABLE_NETWORK=0).
       printf '%s\n' '#!/bin/sh' 'cd /app/packages/database && exec /app/node_modules/.bin/prisma "$@"' \
         > /usr/local/bin/hector-prisma \
       && chmod +x /usr/local/bin/hector-prisma; \
     fi
USER hector
# Requires DATABASE_URL (migration-capable role). Explicit one-off only.
CMD ["hector-prisma", "migrate", "deploy"]

# --- runtime ---
FROM node:${NODE_VERSION}-bookworm-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 hector \
  && useradd --uid 10001 --gid hector --shell /usr/sbin/nologin --create-home hector
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=3001
COPY --from=build --chown=hector:hector /deploy/api ./
USER hector
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
