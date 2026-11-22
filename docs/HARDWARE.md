# Hardware compatibility

**Rule:** nothing is "compatible" until it has worked at a booth with the pbooth agent. The registry
lives in [apps/agent/src/camera/compatibility.json](../apps/agent/src/camera/compatibility.json), and the
booth page shows each camera's status (tested / untested / unsupported / simulated).

## Cameras

| Manufacturer | Model | OS | Connection | Driver | Operations | Status | Known limitations |
|---|---|---|---|---|---|---|---|
| Any | USB webcam (UVC) | any | USB | Browser camera API | preview, capture | works in Chrome; per-model untested | Resolution is a request; the camera decides |
| Canon | EOS R50 / R100 | Linux | USB | gPhoto2 | capture, live view, settings | **untested** | Disable auto power off; use a dummy battery for live view |
| Canon | EOS 2000D / Rebel T7 | Linux | USB | gPhoto2 | capture, live view, settings | **untested** | Mirror flips each capture |
| Nikon | D3500 | Linux | USB | gPhoto2 | capture, live view | **untested** | Limited settings control |
| Nikon | Z50 | Linux | USB | gPhoto2 | capture, live view, settings | **untested** | USB mode must be MTP/PTP |
| Sony | a6000 series | Linux | USB | gPhoto2 | capture | **untested** | Needs "PC Remote"; older bodies may lack remote capture/live view |
| Any | DSLR/mirrorless | Windows | USB | vendor SDK | — | **unsupported (v1)** | Use a webcam, or a Linux booth |

## Printers

| Type | OS | Path | Status | Notes |
|---|---|---|---|---|
| Virtual PDF printer (cups-pdf) | Linux | CUPS | **tested in CI-style Docker run** | Proves the CUPS path end to end |
| DNP DS620 / RX1 | Linux | CUPS + Gutenprint | **untested** | 2×6 needs the driver's 2-inch cut option |
| DNP DS620 / RX1 | Windows | Spooler | **untested** | Use DNP's Windows driver; set cut mode in its defaults |
| Mitsubishi / HiTi / Citizen dye-sub | Linux / Windows | CUPS / Spooler | **untested** | Driver media names vary; check 4×6 maps correctly |
| Ordinary inkjet/laser | Linux / Windows | CUPS / Spooler | **untested** | Fine for testing, not event volume |

## Testing a model (and marking it tested)

1. Connect it to a booth computer with the agent and run `pbooth-agent doctor`.
2. Run a real event rehearsal on the kiosk:
   - At least 50 captures, including unplugging and replugging mid-session.
   - For printers: 4×6, 2×6 (cut) and 5×7, a paper-out, and a recovery.
3. Note anything odd under `limitations`, set `"tested": "tested"` and the agent version in
   `compatibility.json`, and update this table.
