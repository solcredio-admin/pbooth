# Graph Report - pbooth  (2026-11-24)

## Corpus Check
- 241 files · ~93,584 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 15 file(s) not represented in the graph (top: (none) 4, .css 4, .example 1)

## Summary
- 1762 nodes · 4215 edges · 112 communities (82 shown, 30 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 201 edges (avg confidence: 0.85)
- Token cost: 107,330 input · 0 output

## Community Hubs (Navigation)
- API App Wiring
- API Test Helpers
- Booth & Event Services
- Agent Print Queue & Store
- Booth Admin Pages
- Kiosk Guest Screens
- CI Pipeline
- gPhoto2 Camera Driver
- Users, Auth & Roles
- Kiosk API Endpoints
- Settings & Users UI
- CLI & Password Auth
- Printer Providers
- Web Dependencies
- Agent Install & Event Form
- Booths Controller
- Event Schemas & Lifecycle
- Event Detail & Sales
- Enrollment Codes & Devices
- Self-Service & PayMongo
- Booth & Gallery Pages
- Agent Cloud Enrollment
- Agent CLI & CUPS
- Agent Local API
- Print Template Preview
- Simulated Camera
- Agent Package
- Kiosk & Booth Auth Guards
- Events Controller
- Booth Schemas
- Dashboard & Events List
- Architecture Concepts
- API Runtime Deps
- Browser E2E Tests
- API Dev Deps
- Event Photos Controller
- IndexedDB Store
- Web TS Config
- Admin Shell & Marks
- Storage & Backups Service
- API TS Config
- Kiosk Outbox & Keypad
- Dev Docker Compose
- Web Dev Deps
- Agent TS Config
- Guest Galleries
- Photo Processing & Retention
- Kiosk Offline Sync
- Root Package
- Backups Controller
- Device API Controller
- Users Controller
- Login & Theme
- Shader Background
- Auth Controller
- Self-Service Controller
- Booth Simulator
- Photo Upload Controller
- Agent & Hardware Docs
- Device Pairing Docs
- Event Listing
- Compose App Env
- Compose Services
- Booth Status
- Print Layout Plans
- Compose Resources
- Pinned Versions & Design
- API Scripts
- Time Zones
- Uploads & Backups Docs
- API Bootstrap
- Guest Gallery Page
- Keycap Hover Effect
- Self-Service Design Docs
- Web Scripts
- Voucher Cards
- Photo Framing
- Compose Networks
- Phase 10 Reliability Plan
- Root Layout
- Compose Logging
- Security Review
- Pilot & Offline Testing
- Container Start Script
- Postgres Dump/Restore
- Unix Agent Installer
- Kiosk Layout
- Auth Proxy & CSP
- Compose Healthchecks
- API Native Deps
- Error Filter
- Logo Intro
- Compose Build Args
- Update Watch Labels
- Prisma Config
- pnpm Workspace
- Hardware Test Script
- Argon2
- S3 Client
- Cookie Plugin
- Helmet Plugin
- Rate Limit Plugin
- Prisma Client
- Caddy Route Script

## God Nodes (most connected - your core abstractions)
1. `Req` - 63 edges
2. `ApiError` - 60 edges
3. `@nestjs/common` - 41 edges
4. `react` - 41 edges
5. `PrismaService` - 35 edges
6. `next` - 34 edges
7. `Kiosk()` - 34 edges
8. `BoothsService` - 33 edges
9. `send()` - 32 edges
10. `notFound()` - 30 edges

## Surprising Connections (you probably didn't know these)
- `Offline operation (internet drops)` --semantically_similar_to--> `Kiosk outbox SyncQueue (apps/web/src/lib/offline)`  [INFERRED] [semantically similar]
  README.md → docs/ARCHITECTURE.md
- `pbooth (README)` --references--> `pbooth agent (README)`  [EXTRACTED]
  README.md → apps/agent/README.md
- `pbooth (README)` --references--> `Architecture`  [EXTRACTED]
  README.md → docs/ARCHITECTURE.md
- `pbooth (README)` --references--> `Device API (booth computer -> cloud)`  [EXTRACTED]
  README.md → docs/DEVICE_API.md
- `pbooth (README)` --references--> `Hardware compatibility`  [EXTRACTED]
  README.md → docs/HARDWARE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Booth device enroll / heartbeat / config sync flow** — docs_device_api_post_devices_enroll, docs_device_api_post_devices_heartbeat, docs_device_api_get_devices_config, docs_device_api_post_devices_config_ack [EXTRACTED 1.00]
- **Offline durable sync (outbox, service worker, late sync)** — docs_architecture_sync_queue, docs_architecture_kiosk_service_worker, docs_architecture_late_sync, readme_offline_operation [INFERRED 0.85]
- **Photo delivery pipeline (upload, processing, galleries, retention)** — docs_architecture_presigned_upload_flow, docs_architecture_photo_processing_worker, docs_architecture_galleries, docs_architecture_retention [EXTRACTED 1.00]

## Communities (112 total, 30 thin omitted)

### Community 0 - "API App Wiring"
Cohesion: 0.08
Nodes (18): AuditEntry, AuditService, CODES, Config, CONFIG, schema, EventRow, withConfig (+10 more)

### Community 1 - "API Test Helpers"
Cohesion: 0.08
Nodes (37): pg@^8.23.1, newLocalSecret(), signTicket(), TICKET_SECONDS, verifyTicket(), call(), login(), hasPgTools (+29 more)

### Community 2 - "Booth & Event Services"
Cohesion: 0.10
Nodes (5): BoothsService, ApiError, notFound(), EventsService, KioskService

### Community 3 - "Agent Print Queue & Store"
Cohesion: 0.11
Nodes (15): LocalDeps, PAPER, Paper, preparePrint(), dims(), PrintQueue, JobStatus, PrintJob (+7 more)

### Community 4 - "Booth Admin Pages"
Cohesion: 0.11
Nodes (31): BoothsPage(), metadata, EventBoothsPage(), Props, Ago(), BoothCard(), hw(), n() (+23 more)

### Community 5 - "Kiosk Guest Screens"
Cohesion: 0.08
Nodes (37): KioskPage(), KioskSessionPage(), CameraHelp(), camLabel(), Center(), GUEST, isLight(), KEY_MEANS (+29 more)

### Community 6 - "CI Pipeline"
Cohesion: 0.05
Nodes (43): POSTGRES_DB, POSTGRES_PASSWORD, TEST_DATABASE_URL, TEST_S3_ENDPOINT, if, needs, permissions, runs-on (+35 more)

### Community 7 - "gPhoto2 Camera Driver"
Cohesion: 0.10
Nodes (17): explain(), freeOnMac(), GPhoto2Camera, JpegSplitter, parseAutoDetect(), parseConfig(), parseSaved(), SETTINGS (+9 more)

### Community 8 - "Users, Auth & Roles"
Cohesion: 0.09
Nodes (26): loginBody, passwordBody, IS_PUBLIC, Public(), Allow(), allowed(), Role, ROLES (+18 more)

### Community 9 - "Kiosk API Endpoints"
Cohesion: 0.10
Nodes (4): KioskController, KioskReq, SessionsController, SessionsService

### Community 10 - "Settings & Users UI"
Cohesion: 0.12
Nodes (26): metadata, SettingsPage(), BackupList, Backups(), PasswordForm(), submit(), QuickEvent(), QuickEventForm() (+18 more)

### Community 11 - "CLI & Password Auth"
Cohesion: 0.10
Nodes (18): AuthGuard, AuthService, dummyHash(), hashPassword(), MIN_PASSWORD_LENGTH, passwordProblem(), verifyPassword(), newToken() (+10 more)

### Community 12 - "Printer Providers"
Cohesion: 0.10
Nodes (9): FakePrinter, SimulatedPrinter, JobState, PrinterInfo, PrinterProvider, Submit, ps(), WindowsPrinter (+1 more)

### Community 13 - "Web Dependencies"
Cohesion: 0.10
Nodes (28): dependencies, @fontsource-variable/cormorant-garamond@5.3.0, @fontsource-variable/roboto-mono@5.3.0, next@16.4.6, @paper-design/shaders@0.0.82, @paper-design/shaders-react@0.0.82, qrcode@1.5.4, react@19.3.1 (+20 more)

### Community 14 - "Agent Install & Event Form"
Cohesion: 0.12
Nodes (23): AgentInstall(), AgentRemove(), Cmd(), Os, OS_TABS, REMOVE, Step(), useThisOs() (+15 more)

### Community 15 - "Booths Controller"
Cohesion: 0.21
Nodes (4): actor(), BoothsController, EventBoothsController, Req

### Community 16 - "Event Schemas & Lifecycle"
Cohesion: 0.11
Nodes (19): cashiersSchema, deleteSchema, id, configSchema, CreateEvent, createEventSchema, fields, hex (+11 more)

### Community 17 - "Event Detail & Sales"
Cohesion: 0.12
Nodes (17): EventPage(), LAYOUT_LABEL, Props, DeleteZone(), EventCashiers(), EventRevenue(), Revenue, Totals (+9 more)

### Community 18 - "Enrollment Codes & Devices"
Cohesion: 0.15
Nodes (13): newBoothCode(), newDeviceToken(), newEnrollmentCode(), normalizeEnrollmentCode(), pick(), DeviceGuard, ackSchema, Enroll (+5 more)

### Community 19 - "Self-Service & PayMongo"
Cohesion: 0.12
Nodes (4): EventScope, PaymentsController, PaymongoService, SelfServiceService

### Community 20 - "Booth & Gallery Pages"
Cohesion: 0.14
Nodes (16): BoothPage(), Props, DashboardPage(), metadata, EventGalleryPage(), Props, metadata, NewEventPage() (+8 more)

### Community 21 - "Agent Cloud Enrollment"
Cohesion: 0.16
Nodes (12): enroll(), identity(), log(), machineId(), osName(), runAgent(), applyConfig(), hardware() (+4 more)

### Community 22 - "Agent CLI & CUPS"
Cohesion: 0.15
Nodes (13): AGENT_VERSION, DEFAULT_PORT, available(), run(), RunResult, [cmd, ...args], flag(), main() (+5 more)

### Community 23 - "Agent Local API"
Cohesion: 0.16
Nodes (11): CameraProvider, corsHeaders(), hostAllowed(), originAllowed(), liveView(), publicJob(), readBody(), startFeed() (+3 more)

### Community 24 - "Print Template Preview"
Cohesion: 0.22
Nodes (20): placeholder(), PreviewProps, TemplatePreview(), KioskConfig, KioskResult, composeTemplate(), drawFrame(), drawPattern() (+12 more)

### Community 25 - "Simulated Camera"
Cohesion: 0.09
Nodes (4): frame(), SimulatedCamera, UnsupportedCamera, CameraState

### Community 26 - "Agent Package"
Cohesion: 0.11
Nodes (21): bin, pbooth-agent, dependencies, sharp@0.35.5, description, devDependencies, @types/node@24.19.2, typescript@6.0.3 (+13 more)

### Community 27 - "Kiosk & Booth Auth Guards"
Cohesion: 0.17
Nodes (10): hashToken(), redeemSchema, KIOSK_COOKIE, KioskGuard, KioskHeartbeat, kioskHeartbeatSchema, Pair, pairSchema (+2 more)

### Community 28 - "Events Controller"
Cohesion: 0.26
Nodes (3): ALLOW, actor(), EventsController

### Community 29 - "Booth Schemas"
Cohesion: 0.15
Nodes (17): deleteSchema, assignSchema, Camera, cameraSchema, CreateBooth, createBoothSchema, DEFAULT_CAMERA, DEFAULT_PRINTER (+9 more)

### Community 30 - "Dashboard & Events List"
Cohesion: 0.19
Nodes (18): EventsPage(), metadata, STATUSES, Dashboard(), Filter, FILTERS, Hover, plural() (+10 more)

### Community 31 - "Architecture Concepts"
Cohesion: 0.10
Nodes (16): Agent camera/printer providers, Architecture, CSRF: SameSite=Strict + Origin check, Data model (Admin, Event, Booth, Device, Kiosk, Session, Photo, Gallery...), Database-backed admin sessions (SHA-256 of cookie), Event template (apps/web/src/lib/template), Galleries (256-bit tokens), Hardware risks (+8 more)

### Community 32 - "API Runtime Deps"
Cohesion: 0.10
Nodes (20): dependencies, archiver@8.0.0, @aws-sdk/s3-request-presigner@3.1175.0, fastify@5.12.8, @nestjs/common@12.6.0, @nestjs/core@12.6.0, @nestjs/platform-fastify@12.6.0, @nestjs/websockets@12.6.0 (+12 more)

### Community 33 - "Browser E2E Tests"
Cohesion: 0.10
Nodes (11): ADMIN, design, h, ADMIN, ADMIN, h, ADMIN, h (+3 more)

### Community 34 - "API Dev Deps"
Cohesion: 0.15
Nodes (18): devDependencies, concurrently@10.0.7, socket.io-client@4.8.4, @types/archiver@8.0.0, @types/node@24.19.2, @types/pg@8.23.1, typescript@6.0.3, vitest@5.1.1 (+10 more)

### Community 36 - "IndexedDB Store"
Cohesion: 0.19
Nodes (7): IdbStore, req(), ItemKind, Outcome, QueueItem, QueueStatus, Sender

### Community 37 - "Web TS Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 38 - "Admin Shell & Marks"
Cohesion: 0.19
Nodes (11): AdminLayout(), Marks(), Quiet, Intro, Lift, MARKS, NAV, Scene (+3 more)

### Community 40 - "API TS Config"
Cohesion: 0.12
Nodes (15): exclude, extends, compilerOptions, emitDecoratorMetadata, experimentalDecorators, module, moduleResolution, outDir (+7 more)

### Community 41 - "Kiosk Outbox & Keypad"
Cohesion: 0.22
Nodes (3): Keypad(), QueueStore, SyncQueue

### Community 42 - "Dev Docker Compose"
Cohesion: 0.12
Nodes (16): environment, healthcheck, image, ports, volumes, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER (+8 more)

### Community 43 - "Web Dev Deps"
Cohesion: 0.12
Nodes (16): devDependencies, @playwright/test@1.65.1, @types/node@24.19.2, @types/qrcode@1.5.6, @types/react@19.3.0, @types/react-dom@19.3.0, @types/three@0.169.0, typescript@6.0.3 (+8 more)

### Community 44 - "Agent TS Config"
Cohesion: 0.13
Nodes (13): exclude, extends, compilerOptions, module, moduleResolution, outDir, resolveJsonModule, rootDir (+5 more)

### Community 46 - "Photo Processing & Retention"
Cohesion: 0.18
Nodes (3): Fatal, PhotosService, slugify()

### Community 47 - "Kiosk Offline Sync"
Cohesion: 0.21
Nodes (9): cachedConfig(), enqueuePhoto(), hex(), kioskQueue(), saveConfig(), send(), storeOf(), transient() (+1 more)

### Community 48 - "Root Package"
Cohesion: 0.13
Nodes (14): engines, node, name, effect, packageManager, pnpm, overrides, private (+6 more)

### Community 52 - "Login & Theme"
Cohesion: 0.25
Nodes (11): LoginPage(), metadata, frames(), introSize(), LoginForm(), flight(), submit(), wait() (+3 more)

### Community 53 - "Shader Background"
Cohesion: 0.24
Nodes (11): hex(), LOOK, mix(), Scene(), ScrollDriver(), toHex(), useLook(), current() (+3 more)

### Community 56 - "Booth Simulator"
Cohesion: 0.22
Nodes (10): args, beat(), code, errorText, flaky, log(), req(), statePath (+2 more)

### Community 58 - "Agent & Hardware Docs"
Cohesion: 0.22
Nodes (10): gPhoto2 DSLR support (Linux), Real-hardware-path Docker test (gPhoto2 + CUPS), Agent installers (install-agent.ps1 / install-agent.sh), pbooth agent (README), Printing via CUPS / Windows Print Spooler, Simulated agent (--simulate), Compatibility registry (compatibility.json), Hardware compatibility (+2 more)

### Community 59 - "Device Pairing Docs"
Cohesion: 0.20
Nodes (10): Kiosk-agent pairing (5-min cloud ticket -> 12h local token), Config sync via hash in heartbeats, Booth enrollment (40-bit code -> pbd_ device token), Device API (booth computer -> cloud), GET /devices/config, localSecret (kiosk ticket verification), POST /devices/config/ack, POST /devices/enroll (+2 more)

### Community 60 - "Event Listing"
Cohesion: 0.24
Nodes (3): ListEvents, scoped(), toDto()

### Community 61 - "Compose App Env"
Cohesion: 0.18
Nodes (11): environment, ALLOW_SIMULATED_BOOTHS, APP_ORIGIN, DATABASE_URL, PAYMONGO_SECRET_KEY, S3_ACCESS_KEY_ID, S3_BUCKET, S3_ENDPOINT (+3 more)

### Community 62 - "Compose Services"
Cohesion: 0.18
Nodes (11): environment, image, mem_limit, networks, restart, shm_size, volumes, POSTGRES_DB (+3 more)

### Community 63 - "Booth Status"
Cohesion: 0.31
Nodes (7): BoothStatus, boothStatus(), isOnline(), StatusFacts, base, now, status()

### Community 64 - "Print Layout Plans"
Cohesion: 0.31
Nodes (6): LayoutThumb(), landscape(), Plan, plan(), printSheet(), Rect

### Community 65 - "Compose Resources"
Cohesion: 0.20
Nodes (10): cpus, depends_on, image, mem_limit, networks, ports, restart, condition (+2 more)

### Community 66 - "Pinned Versions & Design"
Cohesion: 0.20
Nodes (6): Pinned versions (Phase 1), apps/web Next.js admin app and kiosk, Third-party notices, @paper-design/shaders (Apache-2.0), @shadergradient/react (MIT), three.js (MIT)

### Community 67 - "API Scripts"
Cohesion: 0.22
Nodes (9): scripts, admin, build, dev, migrate:deploy, prisma:generate, start, test (+1 more)

### Community 68 - "Time Zones"
Cohesion: 0.53
Nodes (7): eventWindow(), isValidTimeZone(), offset(), parts(), startOfDayIn(), utcToWallTime(), wallTimeToUtc()

### Community 69 - "Uploads & Backups Docs"
Cohesion: 0.22
Nodes (9): Presigned upload flow (upload-authorize / upload-complete), apps/agent booth computer agent, apps/api NestJS + Fastify REST API, Database backups (pg_dump / pg_restore), Environment variables, Event photo design (strip, grid, one photo), Kiosk (USB webcam booths), pbooth (README) (+1 more)

### Community 70 - "API Bootstrap"
Cohesion: 0.32
Nodes (5): AppModule, loadConfig(), bootstrap(), SAFE_METHODS, @nestjs/core

### Community 71 - "Guest Gallery Page"
Cohesion: 0.36
Nodes (6): GalleryPage(), metadata, Gallery(), Item, luminance(), Meta

### Community 72 - "Keycap Hover Effect"
Cohesion: 0.39
Nodes (7): Cap(), faces, keyAt(), Lift(), paintFace(), pointer, ripple()

### Community 73 - "Self-Service Design Docs"
Cohesion: 0.25
Nodes (7): Event status lifecycle DRAFT->SCHEDULED->ACTIVE->COMPLETED->ARCHIVED, Event.kind MANAGED | SELF_SERVICE, Self-service data model (Package, Payment, VoucherBatch, Voucher), Self-service booths design draft, Vouchers (one-time, hashed codes), Self-service locations (cafes) with vouchers, Users and roles (Super admin, Event admin, Booth admin, Kiosk operator, Cashier)

### Community 74 - "Web Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, e2e, start, test, typecheck

### Community 75 - "Voucher Cards"
Cohesion: 0.48
Nodes (6): EventVouchers(), NewCodes, NewCodesCard(), peso(), status(), VoucherRow

### Community 76 - "Photo Framing"
Cohesion: 0.48
Nodes (5): boothAspect(), frameShot(), frameSize(), Rotation, snapshot()

### Community 77 - "Compose Networks"
Cohesion: 0.29
Nodes (6): name, networks, internal, services, volumes, pgdata

### Community 78 - "Phase 10 Reliability Plan"
Cohesion: 0.38
Nodes (7): Monitoring (Gatus + Telegram), Lockdown protocol for booth computers, Payment references (R-XXXX-XX), Phase 10 plan: unattended reliability, Refund requests, Telegram alerts, Transactions page and CSV

### Community 80 - "Compose Logging"
Cohesion: 0.40
Nodes (6): logging, logging, driver, options, max-file, max-size

### Community 81 - "Security Review"
Cohesion: 0.33
Nodes (5): CSP with per-request nonces (proxy.ts), Network exposure (Tailscale-only bind), Response headers (HSTS, COOP, CSP), Security review (Phase 7), Current deployment (Stravex staging, Veldora Caddy, GHCR image)

### Community 82 - "Pilot & Offline Testing"
Cohesion: 0.33
Nodes (5): Kiosk outbox SyncQueue (apps/web/src/lib/offline), Offline test step, Pilot event checklist, If something goes wrong table, Offline Playwright e2e test (apps/web/e2e/offline.spec.ts)

### Community 83 - "Container Start Script"
Cohesion: 0.33
Nodes (3): children, migrate, names

### Community 84 - "Postgres Dump/Restore"
Cohesion: 0.70
Nodes (4): dumpDatabase(), pgEnv(), restoreDatabase(), run()

### Community 86 - "Unix Agent Installer"
Cohesion: 0.70
Nodes (4): enroll_failed(), has_node24(), install-agent.sh script, step()

### Community 88 - "Auth Proxy & CSP"
Cohesion: 0.50
Nodes (4): config, isPublic(), proxy(), STORAGE

### Community 89 - "Compose Healthchecks"
Cohesion: 0.40
Nodes (5): healthcheck, interval, retries, test, timeout

### Community 90 - "API Native Deps"
Cohesion: 0.33
Nodes (4): @nestjs/platform-socket.io@12.6.0, sharp@0.35.5, sharp, @nestjs/platform-socket.io

### Community 93 - "Logo Intro"
Cohesion: 0.83
Nodes (3): hasWebGL(), Intro(), uniforms()

### Community 94 - "Compose Build Args"
Cohesion: 0.50
Nodes (4): build, PBOOTH_VERSION, args, context

### Community 95 - "Update Watch Labels"
Cohesion: 0.67
Nodes (4): labels, labels, com.centurylinklabs.watchtower.enable, wud.watch

## Knowledge Gaps
- **34 isolated node(s):** `apps/api NestJS + Fastify REST API`, `apps/agent booth computer agent`, `Kiosk (USB webcam booths)`, `Database backups (pg_dump / pg_restore)`, `Environment variables` (+29 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 554 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `Event Detail & Sales` to `Agent Print Queue & Store`, `Booth Admin Pages`, `Admin Shell & Marks`, `Guest Gallery Page`, `Settings & Users UI`, `Web Dependencies`, `Agent Install & Event Form`, `Root Layout`, `Booth & Gallery Pages`, `Login & Theme`, `Kiosk Layout`, `Auth Proxy & CSP`, `Dashboard & Events List`?**
  _High betweenness centrality (0.138) - this node is a cross-community bridge._
- **What connects `apps/api NestJS + Fastify REST API`, `apps/agent booth computer agent`, `Kiosk (USB webcam booths)` to the rest of the system?**
  _34 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API App Wiring` be split into smaller, more focused modules?**
  _Cohesion score 0.07587382779198636 - nodes in this community are weakly interconnected._
- **Why does `@playwright/test` connect `Browser E2E Tests` to `Web Dev Deps`, `Web Dependencies`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Should `API Test Helpers` be split into smaller, more focused modules?**
  _Cohesion score 0.07743496672716274 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Settings & Users UI` to `Booth Admin Pages`, `Kiosk Guest Screens`, `Admin Shell & Marks`, `Guest Gallery Page`, `Keycap Hover Effect`, `Voucher Cards`, `Web Dependencies`, `Agent Install & Event Form`, `Root Layout`, `Event Detail & Sales`, `Booth & Gallery Pages`, `Shader Background`, `Login & Theme`, `Kiosk Layout`, `Print Template Preview`, `Logo Intro`, `Dashboard & Events List`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Should `Booth & Event Services` be split into smaller, more focused modules?**
  _Cohesion score 0.10431372549019607 - nodes in this community are weakly interconnected._