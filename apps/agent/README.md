# pbooth agent

A small program that runs on each booth computer and does what a browser can't:
**DSLR/mirrorless cameras** (via gPhoto2, Linux) and **printing** (CUPS on Linux, the Print Spooler
on Windows). The kiosk page talks to it on `http://127.0.0.1:47800`, and it reports to the cloud
like any booth.

USB-webcam booths don't need it. Install it when a booth has a DSLR or a printer.

## What works where

| | Linux (Ubuntu 24.04) | Windows 10/11 |
|---|---|---|
| DSLR / mirrorless | gPhoto2: live view, capture, basic settings | **Not supported in v1** (needs vendor SDKs) |
| Printing | CUPS (`lp` / `lpstat`) | Print Spooler via PowerShell + .NET (**untested on real Windows yet**) |
| USB webcam | in the kiosk browser (no agent needed) | in the kiosk browser (no agent needed) |

No camera or printer model counts as compatible until it has been tested with this agent. See
[docs/HARDWARE.md](../../docs/HARDWARE.md) for the compatibility registry and how to add a tested model.

## Install

On the booth's admin page, open **Connect → Booth agent**, generate an enrollment code, pick the
computer's OS and copy the one command shown. It installs Node.js 24 if needed, downloads the agent
from your pbooth server (`/agent.zip`, built with each release), enrolls the booth, starts it with
the computer and lists the printers it sees. Running it again later updates the agent.

| | Command | Agent folder | Starts via |
|---|---|---|---|
| Windows (PowerShell as Administrator) | `install-agent.ps1` | `C:\pbooth-agent` | Task Scheduler, as SYSTEM, at startup |
| macOS (Terminal) | `install-agent.sh` | `/Users/Shared/pbooth-agent` | LaunchAgent at login (`deploy/net.pbooth.agent.plist`) |
| Ubuntu 24.04 (Terminal) | `install-agent.sh` | `/opt/pbooth-agent` | systemd (`deploy/pbooth-agent.service`), user `pbooth` |

The scripts live in `apps/web/public/`. Add the printer in the OS first (and print a test page).
On Linux the script also stops the desktop from grabbing the camera (`gio mount -s gphoto2`).

Logs: `journalctl -u pbooth-agent -f` (Linux), `/tmp/pbooth-agent.log` (macOS), Task Scheduler history (Windows).
Check the hardware any time with `node <agent folder>/dist/main.js doctor` (on Linux prefix
`sudo -u pbooth PBOOTH_AGENT_DIR=/var/lib/pbooth-agent`).

State (database, print files) lives in `%ProgramData%\pbooth-agent` (Windows),
`/var/lib/pbooth-agent` (Linux service) or `~/.local/share/pbooth-agent`. Override with `PBOOTH_AGENT_DIR`.

## Print stations

The same agent runs a **print station**: a printer any booth can print to. In the admin, **Stations → your station →
Generate station code**, then run the command on the computer the printer is plugged into. A booth's own computer
can be a station too (run the command there; the booth keeps working). The agent asks the server for prints every
2 seconds and never prints one without the server's yes; see [docs/DEVICE_API.md](../../docs/DEVICE_API.md).

`node apps/agent/test/kill-drill.mjs http://localhost:3399` (after a build, against the dev stack) kills the agent
over and over with several booths printing, and checks that nothing prints twice and the line empties.

## The kiosk and the agent

- The kiosk finds the agent by itself and pairs with no code to type. It asks the cloud for a
  5-minute ticket signed with a secret only this booth's agent knows, and the agent checks it and
  hands back a 12-hour local token.
- The agent listens on **127.0.0.1 only**, answers only your pbooth site's origin, and refuses
  other Host headers (DNS rebinding).
- **Chrome may ask once** whether the site may access devices on your local network. Allow it, because
  that's how the kiosk reaches the agent.
- If the agent stops, the kiosk shows "Waiting for the agent" (DSLR booths) or "The printer isn't
  connected" on the thank-you screen. Guests are never blocked by printing.

## Printing details

- Each print's id is the kiosk session id, so a retried print never prints twice.
- Jobs live in SQLite and survive restarts. A job that was mid-hand-off when the agent stopped is
  **not** resent automatically (it may already be printing). It's marked failed with a note, so you
  check the printer first.
- Paper: 4×6 and 5×7 fill the page at 300 dpi. 2×6 strips go two-up on 4×6 media, for printers that
  cut (e.g. DNP "2-inch cut"). Turn the cut option on in the printer driver's defaults.
- Paper and ink levels are **not** reported: CUPS and the spooler don't expose them reliably.

## Simulated agent (development only)

`enroll … --simulate` makes a SIMULATED booth: a fake camera (labelled frames) and a fake printer
(files in `<state>/simulated-prints`). It needs `ALLOW_SIMULATED_BOOTHS=true` on the server and is
shown as simulated everywhere. Never use it at an event.

## Tests

```bash
pnpm --filter @pbooth/agent test
```

The real-hardware-path test runs gPhoto2 and CUPS (printing to a virtual PDF printer) in Docker.
It proves the agent drives the real tools, not that any specific camera or printer works:

```bash
docker build -t pbooth-agent-hwtest -f apps/agent/test/hardware.Dockerfile apps/agent/test
```

```bash
docker run --rm -v "$PWD":/src:ro pbooth-agent-hwtest sh /src/apps/agent/test/hardware.sh
```
