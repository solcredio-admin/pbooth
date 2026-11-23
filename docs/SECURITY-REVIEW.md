# Security review (Phase 7, 2026-11-23)

What was checked against the live install (pbooth.solcredio.net on Stravex, behind Veldora's Caddy
and Cloudflare) and the code, and what came of it. Re-run the commands before a big event or after
infrastructure changes.

## Results

| Area | Finding | Status |
|---|---|---|
| Dependencies (`pnpm audit --prod`) | `effect` ≤3.22.0 ReDoS (high), via Prisma's config loader | Fixed: pnpm override to `^3.22.1` |
| | `minimatch` <11.0.1 glob DoS (moderate), via archiver → readdir-glob | Accepted: only reachable with attacker-supplied glob patterns; pbooth's ZIP export appends streams and never globs. The fix is a breaking major; revisit when archiver updates |
| Response headers | Pages lacked HSTS (the API had it) | Fixed: HSTS + COOP on every page |
| | Strict CSP with per-request nonces, `frame-ancestors 'none'`, `object-src 'none'`, nosniff, camera limited to the site | OK |
| Admin cookie (`pb_session`) | HttpOnly, Secure (https origin), SameSite=Strict, DB-backed, revocable; Origin check on writes | OK |
| Kiosk cookie (`pb_kiosk`) | HttpOnly, Secure, SameSite=Strict, stored hashed | OK |
| Sign-in | Argon2id; 5 failed attempts per 15 min per IP, then 429 | OK |
| Pairing / enrollment codes | 40-bit random, single use, expiring, stored hashed; 10 attempts / 15 min / IP | OK |
| Gallery links | 256-bit random tokens; can be disabled or rotated | OK |
| Global rate limit | 300 requests / min / IP; 100 KB body limit (photos go straight to R2) | OK |
| Errors | Unknown errors return a generic message; stack only in the server log | OK |
| Secrets | `.env` excluded from the build context; no secrets in image env or layer history; backup tools get the DB password via env, never argv | OK |
| Network | App listens only on Stravex's Tailscale IP (`100.86.234.119:3310`); Postgres publishes no port | OK |
| | Veldora public IP: 3000, 3310, 4000, 5432 closed; direct-to-origin requests (skipping Cloudflare) refused | OK |
| Backups | Database dumped daily to R2 (`backups/`, latest 30), download links only for the signed-in admin; restore tested in CI | OK |
| Monitoring | Gatus: internal health, public health (+ cert expiry, response time), login page; Telegram alerts | OK |

## Re-run

```bash
pnpm audit --prod
curl -sI https://pbooth.solcredio.net/login | grep -iE "strict-transport|content-security|x-frame|referrer|permissions"
for p in 3000 3310 4000 5432; do nc -z -G 3 <veldora-public-ip> $p && echo "$p OPEN" || echo "$p closed"; done
curl -s -o /dev/null -w "%{http_code}\n" --resolve pbooth.solcredio.net:443:<veldora-public-ip> https://pbooth.solcredio.net/api/v1/health   # expect 000
```
