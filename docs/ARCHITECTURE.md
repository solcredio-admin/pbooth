# Architecture

## Shape

```
 Guest phone / Admin browser ──HTTPS──► Cloudflare ──► Veldora Caddy (public TLS)
                                                          │ Tailscale
                                                          ▼
                                   Stravex: pbooth container (one image)
                                   ┌─────────────────────────────────────┐
                                   │ Next.js web  :3000 (published)      │
                                   │   └─ /api/* rewrite ─► NestJS API   │
                                   │                       127.0.0.1:4000│
                                   └──────────────┬──────────────────────┘
                                                  │ private Docker network
                                              PostgreSQL 17 (no published port)

 Later: Booth computer = hardware agent (Node, SQLite, gPhoto2, CUPS/Windows spooler)
        + kiosk in a fullscreen browser, talking to the agent on localhost.
```

## Decisions (and why)

1. **One image, two processes.** `infra/start.mjs` runs migrations, then the API and the web
   server. If either dies, the container exits and Docker restarts it whole. One image, one port:
   simple to deploy and to proxy.
2. **Same origin for web and API.** The browser only talks to the web origin; Next rewrites
   `/api/*` to the API inside the container. Cookies stay first-party and there's no CORS.
   (Phase 2's Socket.IO will be routed by Caddy straight to the API port, since rewrites don't
   carry WebSockets.) *Phase 2 update:* not needed. Socket.IO goes through the same rewrite,
   and WebSocket upgrades work end to end through Cloudflare, Caddy and Next; long-polling
   is the fallback.
3. **Database-backed admin sessions.** The cookie holds 32 random bytes; the database stores only
   their SHA-256. HttpOnly, SameSite=Strict, Secure on https. Logout deletes the row. Password
   change signs out other sessions.
4. **CSRF:** SameSite=Strict cookies plus an Origin check on every non-GET request
   (must equal `APP_ORIGIN`).
5. **Brute force:** 10 login attempts per IP per 15 min, plus a global cap of 20 failed sign-ins
   per 15 min across all IPs (one admin account, so a distributed guesser is capped too). Wrong
   emails take as long as wrong passwords (dummy argon2 verify).
6. **Validation:** Zod schemas on every body, query and path param, via Nest 12's built-in
   Standard Schema pipe. Errors always look like `{ "error": { "code", "message", "details?" } }`.
7. **Time zones:** exact instants in UTC (`timestamptz`) plus the IANA zone. Times are entered on
   the venue's clock; an end time at or before the start means "past midnight". Conversion uses
   only the built-in Intl database (`apps/api/src/events/tz.ts`, unit-tested across DST).
8. **Status lifecycle** in one table (`transitions.ts`), applied with a conditional UPDATE so a
   double click can't apply twice:
   `DRAFT → SCHEDULED → ACTIVE → COMPLETED → ARCHIVED`; activate also from DRAFT (quick setup)
   and from COMPLETED (undo an early complete mid-event); archive from DRAFT/SCHEDULED/COMPLETED,
   never from ACTIVE. Archived events are read-only.
9. **CSP with per-request nonces** (Next `proxy.ts`). No inline styles or scripts; the one
   inline `<style>` Paper Shaders wants is pre-created empty and allowed by the empty-string hash.
10. **Shader-glass design** (from the author's portmap): WebGL gradient that renders only while
    scrolling, liquid-metal logo intro after sign-in, 3D keycap hover on event tiles. Every WebGL
    layer is optional: if WebGL fails, a CSS gradient remains and the app works the same.
    This replaces the originally planned Tailwind + shadcn/ui: the design kit is a complete CSS
    system, and running two styling systems would double the upkeep.
11. **No Redis, no Turborepo, no shared package yet.** pnpm workspaces are enough for two apps.
    Background jobs (Phase 5) will use a Postgres-backed queue. Shared Zod schemas move to
    `packages/shared` when the hardware agent needs them (Phase 4).

## Booths (Phase 2)

- **Booth** = a physical kit, reused across events. **Device** = the computer currently enrolled
  for it (one per booth; re-enrolling replaces it). **EventBooth** = "this booth works this event".
- Stored booth state is only `UNREGISTERED / READY / REVOKED`. The status the admin sees
  (`READY, ONLINE, OFFLINE, ACTIVE, ERROR, REVOKED, UNREGISTERED`) is **computed** from the last
  heartbeat, the reported error and whether a live event is assigned (`booths/status.ts`), so it
  can never be stale.
- **Enrollment:** 40-bit one-time code (30 min, hashed at rest, claimed atomically) → long-lived
  device token (`pbd_…`, 256-bit, hashed at rest). Revoke deletes the device row: the token fails
  on its next request.
- **Config sync:** the server computes a booth's config (camera, printer, live event's guest
  settings) and a short hash of it. Heartbeats return the hash; the booth fetches and acks. No
  counters to keep in step.
- **Double booking:** a booth can be booked for many events but serve one ACTIVE event; enforced
  on assign (to a live event) and on activate.
- **Live updates:** an admin-only Socket.IO room. The handshake needs the session cookie, and a
  foreign Origin is refused (blocks cross-site WebSocket hijacking). Every booth change is pushed;
  a 15 s sweep pushes booths whose heartbeat just aged out (nothing else announces "offline").
- **Simulated booths** use the real device API, are flagged at enrollment, need
  `ALLOW_SIMULATED_BOOTHS=true`, and are badged SIMULATED in every view.
- Device API reference: [DEVICE_API.md](DEVICE_API.md).

Not in Phase 2 (comes with the agent/kiosk): the kiosk's own booth credential, real hardware
discovery, job-level sync lists (only counts today), uptime history.

## Kiosk (Phase 3)

- **Credential:** a kiosk pairing code (same format and lifetime as enrollment codes, bound to the
  booth in the URL) is exchanged for an HttpOnly, SameSite=Strict cookie `pb_kiosk` (180 days,
  hashed at rest, one kiosk per booth). Kiosk endpoints accept only that cookie, admin endpoints
  never accept it, and the kiosk pages ignore the admin session.
- **Webcam booths need no agent:** the kiosk heartbeats too (camera status, actual resolution, the
  webcams it can see). A booth is "seen" when either its agent or its kiosk checks in. Camera
  problems are reported immediately, not at the next scheduled heartbeat.
- **Camera:** `getUserMedia` with the configured device (matched by label) and resolution as an
  *ideal* (never required). The real settings are read back. Unplugging is detected (track
  `ended`, `devicechange`) and retried every 3 s. Permission denial stops retrying and shows a guide.
  Capture uses `ImageCapture.takePhoto()` when available (full sensor resolution), otherwise a
  canvas frame. The preview may be mirrored; photos never are.
- **Sessions:** the kiosk makes a UUID first and sends start/finish in the background with retries.
  Both calls are idempotent, and a session can only start for a booth with a live event.
  shortcut: retries are in memory; a durable queue is Phase 6.
- **Event template:** `apps/web/src/lib/template/` (pure layout math, unit-tested, plus a canvas
  drawer). The same code renders the admin preview and the kiosk's design, so what you see is what
  guests get. It's client-side for now. Phase 5 adds server-side processing with Sharp and storage.
- Reloading mid-session (`/kiosk/<code>/session/<id>`) starts fresh: unsaved photos are gone, and the
  stale session stays STARTED.

## Data model

`Admin`, `AdminSession`, `Event`, `EventConfig` (1:1, guest-experience settings), `AuditLog`,
`Booth`, `Device`, `EventBooth`, `Kiosk`, `Session`. UUID keys, `timestamptz`, indexes on status/date/heartbeat.
Template, Session, Photo, Gallery, PrintJob and UploadJob arrive with their phases.

## Audit log

Sign-in success/failure, sign-out, password changes, admin creation/reset (CLI), event
create/update/each status change, with IP. Never passwords, tokens or cookies.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Repo, auth, DB, dashboard, event CRUD, Docker | **Done** |
| 2 Booths | Registration, enrollment codes, heartbeats, assignment, config sync, live view, simulated booth | **Done** |
| 3 Kiosk | Browser kiosk, USB webcam, countdown, 1–4 shot sequence, retakes, event template, guest flow | **Done** |
| 4 Agent | Local agent, authenticated local API, gPhoto2 DSLR (Linux), CUPS/Windows printing | Next |
| 5 Delivery | Sharp processing, R2 presigned uploads, QR galleries, downloads, export | |
| 6 Offline | Durable queue, restart recovery, idempotent sync, duplicate prevention | |
| 7 Production | Security review, backup/restore test, monitoring, real hardware, pilot event | |

## Hardware risks (carried forward)

- DSLR on Windows needs vendor SDKs (Canon EDSDK etc.); v1 DSLR booths run Linux + gPhoto2.
- gPhoto2 support varies by body and firmware; nothing is "compatible" until tested on it.
- Webcam capabilities vary; ImageCapture is Chromium-only; read back real settings.
- Printer job status often means "sent", not "printed"; no paper/ink claims without driver data.
- If the kiosk page loads from the cloud, an offline reload kills it: production booths should
  load the kiosk from the local agent (decision for Phase 3).

## Infrastructure notes

- Stravex hosts Phase 1 as staging. Before real events, move production to a dedicated VPS (the
  same compose file works). Veldora stays a reverse proxy only.
- Stravex runs WUD with auto-update. pbooth's containers carry `wud.watch=false` so the app and
  database are never swapped automatically (Postgres majors need a real upgrade; app updates
  should happen between events).
- Real client IPs: Cloudflare → Caddy (`client_ip_headers CF-Connecting-IP`) → Next → API.
  `TRUST_PROXY_HOPS` must match that chain; check the IP recorded in `AuditLog` after a sign-in.
