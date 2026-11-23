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
COPY apps/agent/package.json apps/agent/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY apps ./apps
RUN pnpm --filter @pbooth/api build && pnpm --filter @pbooth/web build
# The booth agent, ready to run, served at /agent.zip: unzip, `npm install --omit=dev` (fetches sharp
# for the booth's own OS), enroll. Nothing secret in it; booths still need a one-time enrollment code.
RUN apt-get update && apt-get install -y --no-install-recommends zip && rm -rf /var/lib/apt/lists/* \
 && pnpm --filter @pbooth/agent build \
 && mkdir -p /agent/tools && cp -r apps/agent/dist apps/agent/deploy apps/agent/README.md /agent/ && cp tools/simulate-booth.mjs /agent/tools/ \
 && node -e "const p=require('./apps/agent/package.json'); require('fs').writeFileSync('/agent/package.json', JSON.stringify({name:'pbooth-agent', private:true, type:p.type, description:p.description, dependencies:p.dependencies, scripts:{start:p.scripts.start}}, null, 2))" \
 && (cd /agent && zip -qr /src/apps/web/public/agent.zip .)
# A self-contained API folder with production dependencies only.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @pbooth/api deploy --prod --legacy /out/api \
 && cp -r apps/api/dist apps/api/prisma apps/api/prisma.config.ts /out/api/

FROM node:24-bookworm-slim AS runtime
# pg_dump/pg_restore 17 (must match the server's major version) for database backups.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ARG PBOOTH_VERSION=dev
ENV NODE_ENV=production PBOOTH_VERSION=$PBOOTH_VERSION NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 PORT=3000 API_HOST=127.0.0.1 API_PORT=4000 API_INTERNAL_URL=http://127.0.0.1:4000
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./api
COPY --from=build --chown=node:node /src/apps/web/.next/standalone ./web
COPY --from=build --chown=node:node /src/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build --chown=node:node /src/apps/web/public ./web/apps/web/public
COPY --chown=node:node infra/start.mjs ./start.mjs
COPY --chown=node:node tools ./tools
USER node
EXPOSE 3000
# Goes through the web app to the API to the database: one check covers all three.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "start.mjs"]
