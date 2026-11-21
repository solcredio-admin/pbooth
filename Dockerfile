# One image with both halves of the app: the NestJS API (internal, 127.0.0.1:4000) and the
# Next.js web app (port 3000, which also proxies /api to the API). Postgres runs beside it.
#   docker build -t pbooth .
# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base
# OpenSSL: Prisma's migration engine links against it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /src

# Dependencies first, so source edits don't re-download packages.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY apps ./apps
RUN pnpm --filter @pbooth/api build && pnpm --filter @pbooth/web build
# A self-contained API folder with production dependencies only.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @pbooth/api deploy --prod --legacy /out/api \
 && cp -r apps/api/dist apps/api/prisma apps/api/prisma.config.ts /out/api/

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ARG PBOOTH_VERSION=dev
ENV NODE_ENV=production PBOOTH_VERSION=$PBOOTH_VERSION NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 PORT=3000 API_HOST=127.0.0.1 API_PORT=4000 API_INTERNAL_URL=http://127.0.0.1:4000
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./api
COPY --from=build --chown=node:node /src/apps/web/.next/standalone ./web
COPY --from=build --chown=node:node /src/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build --chown=node:node /src/apps/web/public ./web/apps/web/public
COPY --chown=node:node infra/start.mjs ./start.mjs
USER node
EXPOSE 3000
# Goes through the web app to the API to the database: one check covers all three.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "start.mjs"]
