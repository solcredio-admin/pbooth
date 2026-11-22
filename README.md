# pbooth

A photobooth management platform run by one administrator: create events, (later) assign booths,
run a browser kiosk at the venue, and deliver photos by print and QR gallery.

**Status: Phase 4 (hardware agent).** Admin sign-in, events, booths (enrollment, heartbeats, config
sync, live view), a guest kiosk (1–4 photos, retakes, built-in event design), and the booth agent:
DSLR via gPhoto2 on Linux, printing via CUPS / the Windows spooler. Real camera and printer models
are **untested** until tried on hardware ([docs/HARDWARE.md](docs/HARDWARE.md)). Saving/uploading photos,
QR galleries and the offline upload queue come in later phases
(see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); booth computers talk to the
[device API](docs/DEVICE_API.md)).

```
apps/api   NestJS 12 + Fastify REST API (/api/v1), Prisma 7 + PostgreSQL, admin CLI
apps/web   Next.js 16 admin app, shader-glass design (WebGL gradient, liquid-metal intro), kiosk
apps/agent Booth computer agent: gPhoto2 DSLR, CUPS/Windows printing, local API (see its README)
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
| App + Postgres | Stravex, `~/compose/pbooth` (a git checkout of `main`), published on `100.86.234.119:3310` (Tailscale only) |
| Image | `ghcr.io/solcredio-admin/pbooth:latest`, built and published by CI after the tests pass (public) |
| Public proxy | Veldora Caddy: `pbooth.solcredio.net` → `100.86.234.119:3310` ([snippet](infra/Caddyfile.veldora), [installer](infra/veldora-add-route.sh)) |
| DNS | `*.solcredio.net` via Cloudflare (proxied) |

Stravex is a staging host. Production should move to a dedicated VPS before real events (see
"Infrastructure" in the architecture doc).

Update Stravex after pushing to `main` and seeing CI pass. It pulls the image CI built, so
Stravex doesn't compile anything:

```bash
ssh stravex 'cd ~/compose/pbooth && git pull --ff-only && docker compose pull app && docker compose up -d'
```

Each image is also tagged with its commit (`ghcr.io/solcredio-admin/pbooth:<sha>`). To pin a
version or roll back, set `PBOOTH_IMAGE` to that tag in Stravex's `.env` and run
`docker compose up -d`.

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

## Kiosk (USB webcam booths)

1. On the booth page, **Pair kiosk**. Open `https://<host>/kiosk/<booth code>` in Chrome on the booth
   computer and enter the code (single use, 30 minutes). The browser gets an HttpOnly cookie that
   page scripts can't read. It lasts 180 days and **Unpair** or **Revoke** ends it.
2. Allow the camera when Chrome asks (HTTPS is required). The kiosk lists the webcams it can see.
   Pick one on the booth page, or leave "First available".
3. For a locked-down screen: `google-chrome --kiosk --noerrdialogs https://<host>/kiosk/<code>`.

Guest flow: welcome → get ready → countdown → 1–4 photos in a row (a short countdown between shots)
→ review the finished design (retake one photo or all) → done → clears itself after 20 s. A minute
without a touch abandons the session. Nothing from one guest stays on screen for the next. Each
session is counted on the event's live view.

**DSLR and printing** need the booth agent on the booth computer. See
[apps/agent/README.md](apps/agent/README.md). The kiosk finds and pairs with it automatically.

**Photos are not saved yet.** They live only in the kiosk's memory (DSLR originals also stay on
the booth computer) until upload arrives (Phase 5). The kiosk says so on its last screen.

### Event photo design

Each event has a built-in design, set on the event page under **Photo design**, with a live preview:
- **Photo strip**: 2×6 in, photos stacked.
- **Grid**: 4×6 in. 2×2 for four photos, one wide photo over two for three.
- **One photo**: always a framed 4×6.

The design uses the event's brand and accent colours, the footer text (or the event name) and the
date. It's drawn at 300 dpi, so it's print-sized. A template library with uploaded artwork needs
image storage and comes with R2 (Phase 5).

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
