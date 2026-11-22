# pbooth

A photobooth management platform run by one administrator: create events, (later) assign booths,
run a browser kiosk at the venue, and deliver photos by print and QR gallery.

**Status: Phase 2 (booths).** Admin sign-in, events with a status lifecycle, booth registration,
device enrollment, heartbeats, config sync, event assignment, and a live view per event (Socket.IO).
Kiosk, cameras, printing, photos and galleries come in later phases
(see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); booth computers talk to the
[device API](docs/DEVICE_API.md)).

```
apps/api   NestJS 12 + Fastify REST API (/api/v1), Prisma 7 + PostgreSQL, admin CLI
apps/web   Next.js 16 admin app, shader-glass design (WebGL gradient, liquid-metal intro)
infra/     container entrypoint, dev database, Veldora Caddy snippet
tools/     simulate-booth.mjs: a SIMULATED booth for development and staging
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

## Booths

1. **Booths → Add a booth.** Each gets a code like `PB-7K3M`.
2. On the booth page, **Generate enrollment code** (single use, 30 minutes) and enter it on the
   booth computer. The real agent arrives in Phase 4.
3. Book the booth for an event (from the booth page or the event's **Booths** page).
4. When the event goes live, its booths receive its guest settings. The event's live view
   (`/events/<id>/booths`, or click a live event on the dashboard) shows each booth's status,
   last check-in, camera/printer, pending uploads/prints and whether it applied the latest config.

A booth can be booked for several events but serves only one **live** event at a time. Going live
with a booth that's busy elsewhere is refused. **Revoke** cuts a booth computer off immediately.

### Simulated booth (no hardware)

Needs `ALLOW_SIMULATED_BOOTHS=true` on the server (on for staging, off for production):

```bash
node tools/simulate-booth.mjs --url https://pbooth.solcredio.net --code 7K3M-Q9TX
```

It enrolls through the real device API, then heartbeats and applies config like a booth would.
It's marked **SIMULATED** everywhere and never counts as tested hardware. Options:
`--error "Camera disconnected"` to show an error, `--flaky` to drop heartbeats. Its token is saved
in `.sim-booth-<code>.json` (git-ignored); rerun with `--state <file>` to resume.

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
| `ALLOW_SIMULATED_BOOTHS` | api | `true` lets the simulator enroll (staging only) |
| `BOOTH_OFFLINE_AFTER_SECONDS` | api | No heartbeat this long → offline (default 90) |
| `HEARTBEAT_INTERVAL_SECONDS` | api | How often booths are told to check in (default 20) |
| `PBOOTH_IMAGE` | compose | Image to run (default `ghcr.io/solcredio-admin/pbooth:latest`) |
