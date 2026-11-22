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
import { startLocalServer } from "./local/server.js";
import { mkdirSync } from "node:fs";

export const AGENT_VERSION = "0.4.0";
export const DEFAULT_PORT = 47800;
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

export function identity(store: Store) {
  const [server, token, localSecret, boothId, boothCode] = ["server", "token", "localSecret", "boothId", "boothCode"].map((k) => store.get(k));
  return server && token && localSecret && boothId && boothCode ? { server, token, localSecret, boothId, boothCode, simulated: store.get("simulated") === "true" } : null;
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

export async function enroll(store: Store, server: string, code: string, simulated: boolean) {
  const origin = new URL(server).origin;
  const r = await new Cloud(origin).enroll({ code, simulated, device: { identifier: await machineId(store), hostname: hostname(), os: osName(), agentVersion: AGENT_VERSION } });
  for (const [k, v] of Object.entries({ server: origin, token: r.token, localSecret: r.localSecret, boothId: r.booth.id, boothCode: r.booth.code, boothName: r.booth.name, simulated: String(simulated) })) store.set(k, v);
  return r.booth;
}

/** The long-running agent: heartbeats, config sync, hardware, and the local API for the kiosk. */
export async function runAgent(store: Store, dir: string, port: number) {
  const id = identity(store);
  if (!id) throw new Error("Not enrolled. Run: pbooth-agent enroll --server https://<your pbooth> --code XXXX-XXXX");
  const cloud = new Cloud(id.server, id.token);
  const sim = id.simulated;
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
  let beatNow: () => void = () => undefined;

  const queue = new PrintQueue(store, () => (config?.printer.enabled ? printer : null), join(dir, "prints"), () => beatNow());
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

  await startLocalServer({
    port, version: AGENT_VERSION, simulated: sim, photosDir: join(dir, "photos"),
    allowedOrigins: () => [id.server, ...(process.env.PBOOTH_AGENT_EXTRA_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])],
    identity: () => ({ boothId: id.boothId, boothCode: id.boothCode, localSecret: id.localSecret }),
    camera: () => camera, printer: () => printer, queue,
    getJob: (jid) => store.job(jid), queueSummary: () => store.summary(),
    printSettings: () => ({ enabled: !!config?.printer.enabled, printerName: config?.printer.printerName ?? null, paperSize: config?.printer.paperSize ?? "4x6", orientation: config?.printer.orientation ?? "portrait" }),
  });
  log(`local API on http://127.0.0.1:${port} for ${id.server} (booth ${id.boothCode})`);

  // Heartbeat loop: keeps going through outages; the booth keeps working offline.
  let wait = 20;
  let timer: NodeJS.Timeout | undefined;
  let offline = false;
  const loop = async () => {
    try {
      wait = await heartbeat();
      if (offline) log("cloud reachable again");
      offline = false;
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) { log("cloud rejected this agent's token: the booth was revoked or re-enrolled. Stopping."); process.exit(2); }
      if (!offline) log(`cloud unreachable (${(e as Error).message}); retrying, booth keeps working`);
      offline = true;
    }
    timer = setTimeout(loop, wait * 1000);
  };
  beatNow = () => { clearTimeout(timer); timer = setTimeout(loop, 500); };
  await loop();
}
