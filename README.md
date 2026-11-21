# pbooth

A photobooth management platform run by one administrator: create events, (later) assign booths,
run a browser kiosk at the venue, and deliver photos by print and QR gallery.

**Status: Phase 1 (foundation).** Admin sign-in, events with a full status lifecycle, the
dashboard, and a single Docker image. Booths, kiosk, cameras, printing, photos and galleries
come in later phases (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

```
apps/api   NestJS 12 + Fastify REST API (/api/v1), Prisma 7 + PostgreSQL, admin CLI
apps/web   Next.js 16 admin app, shader-glass design (WebGL gradient, liquid-metal intro)
infra/     container entrypoint, dev database, Veldora Caddy snippet
```

## Run it with Docker (production / staging)

```bash
cp .env.example .env        # set APP_ORIGIN, POSTGRES_PASSWORD, PBOOTH_BIND
docker compose up -d --build
docker compose exec app sh -c "cd /app/api && node dist/cli.js admin:create --email you@example.com"
```

The last command asks for the password (12+ characters) without echoing it. There is no default
admin and no default password.

- The app listens on `PBOOTH_BIND:PBOOTH_PORT` → container port 3000. Postgres publishes no port.
- **Docker-published ports bypass UFW.** Bind to a private address (Tailscale IP or `127.0.0.1`)
  and let Caddy be the only public entry point.
- Migrations run automatically on container start (`prisma migrate deploy`). The container
  refuses to start if they fail.
- Health: `GET /api/v1/health` (goes through web → API → database). Docker runs it every 30 s.

### Current deployment (Solcredio)

| Piece | Where |
|---|---|
| App + Postgres | Stravex, `~/compose/pbooth`, published on `100.86.234.119:3310` (Tailscale only) |
| Public proxy | Veldora Caddy: `pbooth.solcredio.net` → `100.86.234.119:3310` ([snippet](infra/Caddyfile.veldora), [installer](infra/veldora-add-route.sh)) |
| DNS | `*.solcredio.net` via Cloudflare (proxied) |

Stravex is a staging host for Phase 1. Production should move to a dedicated VPS before real
events (see "Infrastructure" in the architecture doc).

Update after code changes:

```bash
rsync -az --delete --exclude node_modules --exclude .next --exclude dist --exclude apps/api/src/generated --exclude .git --exclude .env ./ stravex:~/compose/pbooth/
```

```bash
ssh stravex 'cd ~/compose/pbooth && docker compose up -d --build'
```

## Admin account

```bash
docker compose exec app sh -c "cd /app/api && node dist/cli.js admin:create --email you@example.com"
```

```bash
docker compose exec app sh -c "cd /app/api && node dist/cli.js admin:reset-password"
```

`admin:reset-password` signs out every browser. Both commands accept `--password-stdin` for scripts.
Changing the password in Settings signs out every *other* browser.

## Backups

The database lives in the `pbooth_pgdata` volume. Dump it daily:

```bash
docker compose exec -T db pg_dump -U pbooth -Fc pbooth > pbooth-$(date +%F).dump
```

Restore into an empty database:

```bash
docker compose exec -T db pg_restore -U pbooth -d pbooth --clean --if-exists < pbooth-2026-11-21.dump
```

Copy dumps off the server (TrueNAS only once its pool health and free space are confirmed).
Test a restore before relying on backups.

## Local development

Needs Node 24, pnpm (`corepack enable`), and a Docker runtime (Docker Desktop or OrbStack) for Postgres.

```bash
corepack pnpm install
```

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

```bash
cp .env.example .env    # uncomment the "local development" block
```

```bash
cd apps/api && npx prisma migrate deploy && pnpm build && pnpm admin admin:create --email you@example.com
```

Then run `pnpm dev:api` and `pnpm dev:web` in two terminals and open http://localhost:3000.

## Tests

```bash
pnpm typecheck
```

```bash
cd apps/api && pnpm build && TEST_DATABASE_URL=postgresql://pbooth:pbooth@127.0.0.1:5432/pbooth_test pnpm test
```

Without `TEST_DATABASE_URL` only unit tests run. **The integration tests wipe that database.**
CI (`.github/workflows/ci.yml`) runs both against a Postgres service, then publishes the image to
`ghcr.io/solcredio-admin/pbooth`.

## Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `APP_ORIGIN` | api | Public URL. CSRF origin check; `https://` makes cookies `Secure` |
| `POSTGRES_PASSWORD` | compose | Database password (compose builds `DATABASE_URL` from it) |
| `DATABASE_URL` | api | Postgres connection string (set by compose) |
| `PBOOTH_BIND` / `PBOOTH_PORT` | compose | Where the app port is published |
| `TRUST_PROXY_HOPS` | api | Proxies in front of the API (default 2: Caddy + Next) |
| `SESSION_TTL_HOURS` | api | Session lifetime, default 168 (7 days) |
| `LOGIN_WINDOW_MINUTES` | api | Window for the failed-login limit, default 15 |
| `PBOOTH_IMAGE` | compose | Image to run (default `ghcr.io/solcredio-admin/pbooth:latest`) |
