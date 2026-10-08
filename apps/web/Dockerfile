# syntax=docker/dockerfile:1.7
# Hector Next.js Web — production image (standalone, non-root).
# Build from repository root:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://core-hector.pishete.com \
#     -t hector-web:<sha> .
#
# NEXT_PUBLIC_API_URL is embedded at build time into the browser bundle.
# Changing it after build does NOT update client-side API calls.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.17.1
ARG NEXT_PUBLIC_API_URL=https://core-hector.pishete.com

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV OUTPUT_STANDALONE=1
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/web apps/web
RUN pnpm --filter @hector/web build

FROM node:${NODE_VERSION}-bookworm-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 hector \
  && useradd --uid 10001 --gid hector --shell /usr/sbin/nologin --create-home hector
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
# Standalone output layout (monorepo tracing root = repo root)
COPY --from=build --chown=hector:hector /app/apps/web/public ./apps/web/public
COPY --from=build --chown=hector:hector /app/apps/web/.next/standalone ./
COPY --from=build --chown=hector:hector /app/apps/web/.next/static ./apps/web/.next/static
USER hector
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
