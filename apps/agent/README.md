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

## Install (Linux booth)

```bash
sudo apt install -y nodejs gphoto2 cups git
```

Node.js 24 is required. If Ubuntu's package is older, install Node 24 from nodesource or nvm.

```bash
sudo useradd --system --create-home --groups plugdev,lp pbooth
```

```bash
sudo git clone <your pbooth repo> /opt/pbooth && cd /opt/pbooth && sudo corepack enable && sudo pnpm install --filter @pbooth/agent && sudo pnpm --filter @pbooth/agent build
```

Stop Ubuntu's desktop from grabbing the camera (otherwise gPhoto2 can't claim it):

```bash
gio mount -s gphoto2
```

Enroll: on the booth's admin page click **Generate enrollment code** (under *Booth agent*), then:

```bash
sudo -u pbooth PBOOTH_AGENT_DIR=/var/lib/pbooth-agent node /opt/pbooth/apps/agent/dist/main.js enroll --server https://pbooth.solcredio.net --code XXXX-XXXX
```

Run it as a service:

```bash
sudo cp /opt/pbooth/apps/agent/deploy/pbooth-agent.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now pbooth-agent
```

```bash
journalctl -u pbooth-agent -f
```

Check the hardware at any time:

```bash
sudo -u pbooth PBOOTH_AGENT_DIR=/var/lib/pbooth-agent node /opt/pbooth/apps/agent/dist/main.js doctor
```

## Install (Windows booth, printing only)

1. Install Node.js 24 (LTS) from nodejs.org and the printer's own driver, then print a test page from Windows.
2. Copy the repository to `C:\pbooth`, then in an Administrator PowerShell: `corepack enable; pnpm install --filter @pbooth/agent; pnpm --filter @pbooth/agent build`.
3. Enroll: `node C:\pbooth\apps\agent\dist\main.js enroll --server https://pbooth.solcredio.net --code XXXX-XXXX`
4. Run at startup: Task Scheduler → *Create Task* → "Run whether user is logged on or not", trigger
   *At startup*, action `node.exe` with arguments `--disable-warning=ExperimentalWarning C:\pbooth\apps\agent\dist\main.js run`,
   and "Restart every 1 minute" on failure.
5. `node C:\pbooth\apps\agent\dist\main.js doctor` lists the printers Windows sees.

State (database, print files) lives in `%ProgramData%\pbooth-agent` (Windows),
`/var/lib/pbooth-agent` (Linux service) or `~/.local/share/pbooth-agent`. Override with `PBOOTH_AGENT_DIR`.

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
