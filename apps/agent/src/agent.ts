import { statfs, readFile } from "node:fs/promises";
import { hostname, platform, release } from "node:os";
import { join } from "node:path";
import { Cloud, CloudError, type DeviceConfig } from "./cloud.js";
import type { Store } from "./store.js";
import { GPhoto2Camera } from "./camera/gphoto2.js";
import { SimulatedCamera, UnsupportedCamera } from "./camera/simulated.js";
import type { CameraInfo, CameraProvider } from "./camera/types.js";
import { CupsPrinter } from "./printer/cups.js";
import { WindowsPrinter } from "./printer/windows.js";
import { SimulatedPrinter } from "./printer/simulated.js";
import type { PrinterInfo, PrinterProvider } from "./printer/types.js";
import { PrintQueue } from "./printer/queue.js";
import { Station } from "./station.js";
import { startLocalServer } from "./local/server.js";
import { mkdirSync } from "node:fs";

export const AGENT_VERSION = "0.5.0";
const STATION_POLL_MS = 2000;
export const DEFAULT_PORT = 47800;
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

export function identity(store: Store) {
  const [server, token, localSecret, boothId, boothCode] = ["server", "token", "localSecret", "boothId", "boothCode"].map((k) => store.get(k));
  return server && token && localSecret && boothId && boothCode ? { server, token, localSecret, boothId, boothCode, simulated: store.get("simulated") === "true" } : null;
}

/** This computer's own station, if it was enrolled with a station code. */
export function stationIdentity(store: Store) {
  const [server, token, code] = ["server", "stationToken", "stationCode"].map((k) => store.get(k));
  return server && token && code ? { server, token, code } : null;
}

export async function machineId(store: Store) {
  const saved = store.get("identifier");
  if (saved) return saved;
  let id = "";
  try { id = (await readFile("/etc/machine-id", "utf8")).trim(); } catch { /* not Linux */ }
  if (!id) id = `pbooth-${crypto.randomUUID()}`;
  store.set("identifier", id);
  return id;
}

export const osName = () => `${platform() === "win32" ? "Windows" : platform() === "darwin" ? "macOS" : "Linux"} ${release()}`;

/** A booth code makes this computer the booth's; a station code adds (or replaces) its print station. */
export async function enroll(store: Store, server: string, code: string, simulated: boolean) {
  const origin = new URL(server).origin;
  const r = await new Cloud(origin).enroll({ code, simulated, stations: true, device: { identifier: await machineId(store), hostname: hostname(), os: osName(), agentVersion: AGENT_VERSION } });
  if (store.get("server") !== origin) for (const k of ["token", "stationToken"]) store.set(k, ""); // another server: start over
  const values = "booth" in r
    ? { token: r.token, localSecret: r.localSecret, boothId: r.booth.id, boothCode: r.booth.code, boothName: r.booth.name }
    : { stationToken: r.token, stationCode: r.station.code };
  for (const [k, v] of Object.entries({ server: origin, simulated: String(simulated), ...values })) store.set(k, v);
  return "booth" in r ? { kind: "booth", ...r.booth } : { kind: "station", ...r.station };
}

/** The long-running agent: heartbeats, config sync, hardware, and the local API for the kiosk. */
export async function runAgent(store: Store, dir: string, port: number) {
  const id = identity(store), own = stationIdentity(store);
  const server = store.get("server");
  if (!server || (!id && !own)) throw new Error("Not enrolled. Run: pbooth-agent enroll --server https://<your pbooth> --code XXXX-XXXX");
  const cloud = new Cloud(server, id?.token);
  const sim = store.get("simulated") === "true";
  const printsOut = join(dir, "simulated-prints");
  if (sim) mkdirSync(printsOut, { recursive: true });
  if (sim) log("SIMULATED agent: fake camera and printer. Never use this mode at a real event.");

  let config: DeviceConfig | null = null;
  let applied: string | undefined;
  let camera: CameraProvider | null = null;
  let cameras: CameraInfo[] = [];
  let printers: PrinterInfo[] = [];
  let printerError: string | null = null;
  const printer: PrinterProvider | null = sim ? new SimulatedPrinter(printsOut) : platform() === "win32" ? new WindowsPrinter() : new CupsPrinter();
  let boothGone = false, ownGone = false;
  let beatNow: () => void = () => undefined;

  const queue = new PrintQueue(store, () => printer, join(dir, "prints"), () => beatNow());
  queue.start();

  async function applyConfig(c: DeviceConfig) {
    const wantDslr = c.camera.provider === "gphoto2";
    if (!wantDslr) { await camera?.disconnect(); camera = null; }
    else {
      if (!camera) camera = sim ? new SimulatedCamera() : platform() === "win32" ? new UnsupportedCamera("DSLR on Windows needs vendor SDKs, which pbooth v1 doesn't include. Use a USB webcam or a Linux booth.") : new GPhoto2Camera();
      const s = await camera.connect(c.camera.deviceName);
      log(`camera: ${s.status}${s.name ? ` (${s.name}, ${s.compatibility})` : ""}${s.error ? ` — ${s.error}` : ""}`);
    }
    config = c;
  }

  async function hardware() {
    if (camera && camera.kind !== "unsupported" && camera.getStatus().status !== "connected") await camera.connect(config?.camera.deviceName); // plugged back in?
    if (camera) cameras = await camera.discover();
    try { printers = printer ? await printer.discover() : []; printerError = null; }
    catch (e) { printers = []; printerError = platform() === "win32" ? (e as Error).message : "CUPS isn't available (sudo apt install cups)"; }
  }

  async function heartbeat() {
    await hardware();
    const cam = camera?.getStatus();
    const ps = config?.printer;
    const chosen = ps?.enabled ? printers.find((p) => (ps.printerName ? p.name === ps.printerName : p.isDefault)) : undefined;
    const problems = [
      cam && cam.status !== "connected" ? cam.error ?? `Camera ${cam.status}` : null,
      ps?.enabled && !chosen ? printerError ?? (ps.printerName ? `Printer "${ps.printerName}" not found` : "No default printer") : null,
      chosen?.status === "stopped" ? `Printer stopped${chosen.message ? `: ${chosen.message}` : ""}` : null,
    ].filter(Boolean);
    const fsStat = await statfs(dir).catch(() => null);
    const summary = store.summary();
    const r = await cloud.heartbeat({
      agentVersion: AGENT_VERSION, os: osName(), hostname: hostname(), configVersion: applied,
      lastError: problems.length ? problems.join(" · ") : null,
      storage: fsStat ? { freeBytes: Number(fsStat.bavail) * Number(fsStat.bsize), totalBytes: Number(fsStat.blocks) * Number(fsStat.bsize) } : undefined,
      pendingUploads: 0, pendingPrints: summary.queued,
      camera: cam ? { status: cam.status === "unsupported" ? "unsupported" : cam.status, name: cam.name, model: cam.model, compatibility: cam.compatibility } : undefined,
      printer: chosen ? { status: chosen.status === "stopped" ? "error" : "connected", name: chosen.name } : ps?.enabled ? { status: "disconnected" } : undefined,
      cameras: cameras.map((c) => ({ id: c.id, name: c.name, provider: c.provider === "simulated" ? "gphoto2" : c.provider })),
      printers: printers.map((p) => ({ name: p.name, isDefault: p.isDefault })),
      printJobs: summary,
    });
    if (r.configVersion !== applied) {
      const c = await cloud.config();
      await applyConfig(c);
      await cloud.ack(c.version);
      applied = c.version;
      log(`config ${c.version} applied: ${c.event ? `serving "${c.event.name}"` : "no live event"}, camera ${c.camera.provider}, printing ${c.printer.enabled ? "on" : "off"}`);
    }
    return r.heartbeatIntervalSeconds;
  }

  // ---------- print station: its own token, or the booth's when that runs a station too ----------
  let seenAt = 0;
  let seen: { error: string | null; printers: { name: string; isDefault?: boolean }[] } = { error: null, printers: [] };
  const printerState = async (s: { printerName: string | null }) => {
    if (Date.now() - seenAt < 8000) return seen; // asking the OS is slow on Windows
    try {
      const all = printer ? await printer.discover() : [];
      const p = all.find((x) => (s.printerName ? x.name === s.printerName : x.isDefault));
      seen = { printers: all.map((x) => ({ name: x.name, isDefault: x.isDefault })), error: !p ? (s.printerName ? `Printer "${s.printerName}" not found` : "No default printer") : p.status === "stopped" ? `Printer stopped${p.message ? `: ${p.message}` : ""}` : null };
    } catch (e) { seen = { printers: [], error: (e as Error).message }; }
    seenAt = Date.now();
    return seen;
  };
  const about = { agentVersion: AGENT_VERSION, os: osName(), hostname: hostname() };
  const runStation = async (token: string) => {
    const station = new Station(store, queue, new Cloud(server, token), printerState, about);
    let name = "", problem = "";
    for (;;) {
      let moved = false;
      try {
        moved = await station.tick();
        if (!name) log(`print station ${(name = station.settings!.name)} (${station.settings!.code})`);
        problem = "";
      } catch (e) {
        if (e instanceof CloudError && e.status === 401) { log("this computer isn't a print station any more"); return; }
        if (problem !== (e as Error).message) log(`station: ${(problem = (e as Error).message)}; retrying`);
      }
      await new Promise((r) => setTimeout(r, moved ? 300 : STATION_POLL_MS));
    }
  };
  if (own) void runStation(own.token).then(() => { if (!id || boothGone) process.exit(2); ownGone = true; });
  let shared = false;
  const maybeShared = () => {
    if (own || shared || !id || !config?.stationHere) return;
    shared = true;
    void runStation(id.token).then(() => { shared = false; });
  };
  if (!id) return; // a station only: no booth to check in for, no kiosk to serve

  await startLocalServer({
    port, version: AGENT_VERSION, simulated: sim, photosDir: join(dir, "photos"),
    allowedOrigins: () => [server, ...(process.env.PBOOTH_AGENT_EXTRA_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])],
    identity: () => ({ boothId: id.boothId, boothCode: id.boothCode, localSecret: id.localSecret }),
    camera: () => camera, printer: () => printer, queue,
    getJob: (jid) => store.job(jid), queueSummary: () => store.summary(),
    printSettings: () => ({ enabled: !!config?.printer.enabled, printerName: config?.printer.printerName ?? null, paperSize: config?.printer.paperSize ?? "4x6", orientation: config?.printer.orientation ?? "portrait" }),
  });
  log(`local API on http://127.0.0.1:${port} for ${server} (booth ${id.boothCode})`);

  // Heartbeat loop: keeps going through outages; the booth keeps working offline.
  let wait = 20;
  let timer: NodeJS.Timeout | undefined;
  let offline = false;
  const loop = async () => {
    try {
      wait = await heartbeat();
      maybeShared();
      if (offline) log("cloud reachable again");
      offline = false;
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) { 
        log("cloud rejected this agent's token: the booth was revoked or re-enrolled. Stopping.");
        if (!own || ownGone) process.exit(2);
        boothGone = true; // the print station carries on
        return;
      }
      if (!offline) log(`cloud unreachable (${(e as Error).message}); retrying, booth keeps working`);
      offline = true;
    }
    timer = setTimeout(loop, wait * 1000);
  };
  beatNow = () => { clearTimeout(timer); timer = setTimeout(loop, 500); };
  await loop();
}
