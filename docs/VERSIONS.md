# Pinned versions (Phase 1, 2026-11-21)

Exact versions are pinned in each `package.json` and locked in `pnpm-lock.yaml`.

| Area | Package | Version | Note |
|---|---|---|---|
| Runtime | Node.js | 24 LTS | `.nvmrc`, Docker `node:24-bookworm-slim` |
| | pnpm | 10.34.9 | via corepack (`packageManager`) |
| API | @nestjs/core, common, platform-fastify | 12.6.0 | ESM-only major; built-in Standard Schema validation |
| | fastify | 5.12.8 | |
| | @fastify/helmet / cookie / rate-limit | 13.2.0 / 11.1.5 / 11.3.0 | |
| | prisma, @prisma/client, @prisma/adapter-pg | 7.10.1 | 8.x is still a release candidate |
| | argon2 | 0.45.2 | argon2id password hashing |
| | zod | 4.6.7 | |
| | typescript | 6.0.3 | 7.x (native compiler) not adopted yet: decorator metadata support unverified |
| Web | next | 16.4.6 | `proxy.ts` (formerly middleware), standalone output |
| | react, react-dom | 19.3.1 | |
| | three | 0.169.0 | **pinned**: @shadergradient/react's shaders target it |
| | @react-three/fiber | 9.8.2 | |
| | @shadergradient/react | 2.4.20 | |
| | @paper-design/shaders(-react) | 0.0.82 | liquid-metal intro (Apache-2.0) |
| | @fontsource-variable/cormorant-garamond, roboto-mono | see lockfile | self-hosted fonts (OFL) |
| Tests | vitest | 5.1.1 | |
| | @playwright/test | 1.65.1 | installed; browser tests start in Phase 3 (kiosk) |
| Database | postgres (Docker) | 17-alpine | major pinned; WUD auto-update disabled via label |
