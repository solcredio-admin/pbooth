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
  canvas frame. The preview may be mirrored; photos never are. Originals keep the camera's
  whole frame. The **preview box takes the shape of the template slot the next shot fills** (centre
  crop, the same rule `composeTemplate` uses), so what guests frame is exactly what lands in the
  design. "Best available" requests only a width, so 4:3 webcams aren't pushed into a cropped 16:9 mode.
- **Sessions:** the kiosk makes a UUID first and sends start/finish in the background with retries.
  Both calls are idempotent, and a session can only start for a booth with a live event.
  shortcut: retries are in memory; a durable queue is Phase 6.
- **Event template:** `apps/web/src/lib/template/` (pure layout math, unit-tested, plus a canvas
  drawer). The same code renders the admin preview and the kiosk's design, so what you see is what
  guests get. It's client-side for now. Phase 5 adds server-side processing with Sharp and storage.
- Reloading mid-session (`/kiosk/<code>/session/<id>`) starts fresh: unsaved photos are gone, and the
  stale session stays STARTED.

## Hardware agent (Phase 4)

- `apps/agent`: Node 24, no framework. It uses `node:http` for the local API and `node:sqlite` for
  durable state (no native database build), plus Sharp for print files. It runs on Linux and Windows.
- **Providers** behind small interfaces (`camera/types.ts`, `printer/types.ts`):
  - gPhoto2 (CLI, Linux) for cameras.
  - CUPS (`lp`/`lpstat`) and the Windows spooler (PowerShell + `System.Drawing.Printing`) for printers.
  - Clearly labelled simulated camera and printer for development.

  Programs run without a shell, with timeouts.
- **Local API security:**
  - Bound to 127.0.0.1 only.
  - The Host header must be a loopback name (DNS rebinding).
  - The Origin must be the enrolled pbooth site, and CORS headers never name any other origin.
  - Chrome's private-network preflight is answered.
  - Every hardware endpoint needs a local token. Tokens come only from `/pair` with a
    cloud-signed, booth-bound, 5-minute ticket (HMAC with the device's `localSecret`, shared only at
    enrollment), live 12 h, and are kept in memory. The live-view `<img>` passes its token in the URL;
    no other endpoint accepts that.
- **Print jobs:** id = kiosk session id (idempotent). They're kept in SQLite, retried up to 3 times when
  the hand-off fails, and polled every 3 s. A job caught mid-hand-off by a restart is failed rather than
  resent (no double prints). Print files are made at 300 dpi; 2×6 goes two-up on 4×6.
- **Kiosk:** probes the agent only on booths that need it (DSLR or printing on), so webcam-only booths
  never trigger Chrome's local-network prompt. DSLR live view is the agent's MJPEG stream. Printing
  starts on "Looks great" and is reported on the done screen; it never blocks the guest.
- **Honesty:** the compatibility registry starts every model as *untested*; Windows DSLR is
  *unsupported*; ink/paper levels aren't claimed. The Docker hardware test proves the real gPhoto2
  and CUPS paths (to a virtual PDF printer), not specific models.

## Photo delivery (Phase 5)

- **Storage** is any S3-compatible bucket (Cloudflare R2 in production; SeaweedFS in tests, since
  MinIO and LocalStack images are no longer freely available). It's optional: with no `S3_*` set,
  nothing breaks and photos aren't saved.
- **Upload:**
  1. The booth calls `upload-authorize` with a kiosk-made photo UUID, size and SHA-256.
  2. It gets a 10-minute signed PUT. The size, type and checksum headers are all signed, so the
     bucket refuses a different file.
  3. The browser PUTs straight to R2.
  4. `upload-complete` HEADs the object and compares size and checksum.

  Both calls are idempotent.
- **Processing** treats the Photo table as the queue: a 2 s worker claims rows with a conditional
  update, so it's restart-safe and needs no Redis. It re-hashes the bytes (end-to-end integrity, whatever
  the bucket checked) and reads them with Sharp (must be a real JPEG, ≤ 12 000 px; filenames and
  browser types are never trusted). Then it writes the 480 px thumbnail and 1600 px preview, retrying
  up to 3 times.
- **Galleries:**
  - Each has a 256-bit token. The kiosk makes the session token at the start, so the QR works even
    if the network drops.
  - Guests read `/galleries/:token` from their own browser (per-guest rate limits). Unknown, disabled
    or expired all give the same 404.
  - Views are counted. Event-wide links are rotatable.
- **Retention:** an hourly job deletes the objects and closes the galleries of events past
  `endsAt + galleryRetentionDays`. Admins can delete a photo, a session or a whole event at any time.
  Rows are kept as DELETED for counts and the audit log.
- **Export** streams a store-only ZIP straight from the bucket. The Next rewrite timeout is raised for it.
- **Privacy:** the kiosk shows a consent line before shooting (retention days, link-only sharing),
  and every gallery has a privacy footer with its deletion date. Presigned URLs are never logged.
- shortcut: kiosk uploads retry from the page's memory. A closed browser or a long outage still
  loses unsent photos until Phase 6's durable queue (IndexedDB / agent SQLite).

## Data model

`Admin`, `AdminSession`, `Event`, `EventConfig` (1:1, guest-experience settings), `AuditLog`,
`Booth`, `Device`, `EventBooth`, `Kiosk`, `Session`, `Photo`, `Gallery`. UUID keys, `timestamptz`, indexes on status/date/heartbeat.
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
| 4 Agent | Local agent, authenticated local API, gPhoto2 DSLR (Linux), CUPS/Windows printing | **Done** (hardware models untested) |
| 5 Delivery | Sharp processing, R2 presigned uploads, QR galleries, downloads, export | **Done** (R2 itself pending your bucket) |
| 6 Offline | Durable queue, restart recovery, idempotent sync, duplicate prevention | Next |
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
