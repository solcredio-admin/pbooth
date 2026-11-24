# Device API (booth computer → cloud)

What a booth computer (the hardware agent from Phase 4, or `tools/simulate-booth.mjs` today)
uses to talk to pbooth. Base URL: `https://<your host>/api/v1`. JSON in, JSON out. Errors use the
same shape as the rest of the API: `{ "error": { "code", "message", "details?" } }`.

## 1. Enroll (once per computer)

The admin opens the booth page and clicks **Generate enrollment code** (single use, 30 minutes).

```
POST /devices/enroll
{ "code": "7K3M-Q9TX",
  "device": { "identifier": "machine-id", "hostname": "booth-pc", "os": "Ubuntu 24.04", "agentVersion": "0.4.0" },
  "simulated": false }
→ 200 { "token": "pbd_…", "localSecret": "…", "booth": { "id", "name", "code" }, "heartbeatIntervalSeconds": 20 }
```

- `localSecret` lets the agent verify kiosk pairing tickets (`POST /kiosk/agent-ticket` on the cloud,
  `POST /pair` on the agent). Keep it as private as the token.
- The token is returned **once**. Store it with owner-only file permissions. The server keeps
  only its SHA-256.
- Case, dashes and look-alike letters in the code don't matter (`o`→`0`, `i`/`l`→`1`).
- Wrong, used or expired codes get `401 INVALID_CODE`. The endpoint allows 10 attempts per IP per 15 minutes.
- Enrolling a new computer for a booth replaces the old one (its token stops working).
- `simulated: true` needs `ALLOW_SIMULATED_BOOTHS=true` on the server and is shown as SIMULATED
  everywhere in the admin.

All calls below send `Authorization: Bearer pbd_…`. `401 DEVICE_UNAUTHORIZED` means the booth was
revoked or re-enrolled: stop and ask for a new code.

## 2. Heartbeat (every `heartbeatIntervalSeconds`)

```
POST /devices/heartbeat
{ "agentVersion": "0.4.0", "configVersion": "ff348f88d7cb", "lastError": null,
  "storage": { "freeBytes": 182000000000, "totalBytes": 256000000000 },
  "pendingUploads": 2, "pendingPrints": 0,
  "camera":  { "status": "connected", "name": "Canon EOS R50" },
  "printer": { "status": "connected", "name": "DNP DS620" },
  "cameras":  [{ "id": "usb:001,004", "name": "Canon EOS R50", "provider": "gphoto2" }],
  "printers": [{ "name": "DNP DS620", "isDefault": true }] }
→ 200 { "configVersion": "ff348f88d7cb", "heartbeatIntervalSeconds": 20, "serverTime": "…" }
```

- Every field is optional. Send only what you actually know: no made-up statuses.
- `lastError` non-null → the booth shows **Error** until a heartbeat clears it.
- No heartbeat for `BOOTH_OFFLINE_AFTER_SECONDS` (default 90) → **Offline**.
- `cameras` / `printers` are what the computer found. The admin picks from them.
- If the returned `configVersion` differs from what you run, fetch the config.

## 3. Config sync

```
GET /devices/config
→ 200 { "version": "ff348f88d7cb",
        "booth": { "id", "name", "code" },
        "camera":  { "provider": "webcam|gphoto2", "deviceName": null, "resolution": "auto|720p|1080p|4k", "orientation": "landscape|portrait", "mirrorPreview": true },
        "printer": { "enabled": false, "printerName": null, "paperSize": "4x6|2x6|5x7", "orientation": "portrait|landscape" },
        "heartbeatIntervalSeconds": 20,
        "event": null | { "id", "name", "timeZone", "startsAt", "endsAt",
                          "guest": { "welcomeTitle", "welcomeMessage", "primaryColor", "accentColor",
                                     "countdownSeconds", "shotsPerSession", "printEnabled", "printCopies", "galleryEnabled" } } }

POST /devices/config/ack   { "version": "ff348f88d7cb" }   → 200 { "ok": true }
```

`event` is the booth's **live** event (status ACTIVE), or `null`. The version is a hash of
everything in the payload, so any change (booth settings, event going live, guest settings on a
live event) produces a new version. The admin sees "Up to date" once the booth acks it.

`printer` is the booth's station when it's on the same computer (`enabled: false` otherwise), so agents before
0.5.0 keep printing. `stationHere: true` means this booth's own token also runs a station (section 4).

## 4. Print stations (agent 0.5.0 and later)

A station is a printer and its computer. `POST /devices/enroll` with a **station** code and `"stations": true`
returns `{ "token", "station": { "id", "name", "code" } }`. Calls below use that token (or the booth's, see above).

```
POST /station/poll   every 2 s
{ "ready": true, "error": null, "printers": [{ "name": "DNP DS620", "isDefault": true }], "agentVersion", "os", "hostname" }
→ 200 { "station": { "id", "name", "code", "enabled", "printerName", "paperSize", "orientation" },
        "jobs": [{ "id", "attempt", "status": "CLAIMED|PRINTING", "copies", "strip", "backup", "sha256", "url" }] }

POST /station/jobs/:id   { "attempt": 1, "status": "PRINTING|DONE|FAILED", "error": null, "safe": false }
→ 200, or 409 NOT_YOURS (finished, moved, or another attempt)
```

- `jobs` is everything this station holds (at most one new job at a time), so a lost answer is just another poll.
- **Report `PRINTING` and get a 200 before handing anything to the printer.** Until then the server may give the
  job to another station (after `PRINT_RELEASE_SECONDS` of silence, default 30). A 409 means: don't print.
- `FAILED` with `safe: true` only when certain nothing came out: the job goes back in line by itself (up to 6
  times). Without `safe`, it waits for staff.
- A higher `attempt` is a new permission to print; the same one never is.
- `401 STATION_UNAUTHORIZED`: signed out or deleted.
