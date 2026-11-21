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
   carry WebSockets.)
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

## Data model (Phase 1)

`Admin`, `AdminSession`, `Event`, `EventConfig` (1:1, guest-experience settings), `AuditLog`.
UUID keys, `timestamptz`, indexes on status/date. Booth, Device, EventBooth, Template, Session,
Photo, Gallery, PrintJob and UploadJob arrive with their phases as new migrations.

## Audit log

Sign-in success/failure, sign-out, password changes, admin creation/reset (CLI), event
create/update/each status change, with IP. Never passwords, tokens or cookies.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Repo, auth, DB, dashboard, event CRUD, Docker | **Done** |
| 2 Booths | Registration, enrollment codes, heartbeats, assignment, config sync, simulated booth | Next |
| 3 Kiosk | Browser kiosk, USB webcam, countdown, capture/retake, guest flow | |
| 4 Agent | Local agent, authenticated local API, gPhoto2 DSLR (Linux), CUPS/Windows printing | |
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
