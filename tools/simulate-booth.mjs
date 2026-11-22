#!/usr/bin/env node
// SIMULATED BOOTH — for development and staging only.
// Behaves like a booth computer through the real device API (enroll → heartbeat → config → ack),
// but reports made-up hardware. The server marks it SIMULATED everywhere; it never counts as a
// real, tested device. The server must have ALLOW_SIMULATED_BOOTHS=true.
//
//   node tools/simulate-booth.mjs --url https://pbooth.solcredio.net --code 7K3M-Q9TX
//   node tools/simulate-booth.mjs --url ... --state .sim-booth.json        (resume after a restart)
//   options: --error "Camera disconnected"   report an error     --flaky   drop ~1 in 4 heartbeats
//
// No dependencies; needs Node 18+.
import { readFile, writeFile } from "node:fs/promises";
import { hostname, platform, release } from "node:os";

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const url = (arg("url", "http://localhost:3000")).replace(/\/$/, "");
const code = arg("code");
const statePath = arg("state", code ? `.sim-booth-${code.replace(/\W/g, "")}.json` : ".sim-booth.json");
const errorText = arg("error", null);
const flaky = args.includes("--flaky");
const api = `${url}/api/v1`;
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} [sim] ${m}`);

async function req(method, path, token, body) {
  const res = await fetch(api + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? `HTTP ${res.status}`), { status: res.status });
  return json;
}

async function loadState() {
  try { return JSON.parse(await readFile(statePath, "utf8")); } catch { return null; }
}

let state = await loadState();
if (!state) {
  if (!code) { console.error("No saved state: pass --code with an enrollment code from the booth page."); process.exit(1); }
  const identifier = `sim-${hostname()}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await req("POST", "/devices/enroll", null, {
    code, simulated: true, device: { identifier, hostname: `${hostname()} (simulated)`, os: `${platform()} ${release()}`, agentVersion: "sim-0.2.0" },
  }).catch((e) => { console.error(`Enrollment failed: ${e.message}`); process.exit(1); });
  state = { token: r.token, booth: r.booth, identifier };
  await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 }); // holds the device token: keep it private
  log(`enrolled as ${r.booth.name} (${r.booth.code}); token saved to ${statePath}`);
}

let applied = null;
let interval = 20;
let uploads = 0;

async function syncConfig() {
  const cfg = await req("GET", "/devices/config", state.token);
  await req("POST", "/devices/config/ack", state.token, { version: cfg.version });
  applied = cfg.version;
  interval = cfg.heartbeatIntervalSeconds ?? interval;
  log(`applied config ${cfg.version}: ${cfg.event ? `serving "${cfg.event.name}"` : "no live event"}, camera ${cfg.camera.provider}/${cfg.camera.resolution}`);
}

async function beat() {
  if (flaky && Math.random() < 0.25) { log("(flaky) skipped a heartbeat"); return; }
  uploads = Math.max(0, uploads + Math.round(Math.random() * 2 - 0.8)); // a small, wandering queue
  const r = await req("POST", "/devices/heartbeat", state.token, {
    agentVersion: "sim-0.2.0",
    configVersion: applied ?? undefined,
    lastError: errorText,
    storage: { freeBytes: 182_000_000_000, totalBytes: 256_000_000_000 },
    pendingUploads: uploads,
    pendingPrints: 0,
    camera: { status: errorText ? "error" : "connected", name: "Simulated camera" },
    printer: { status: "connected", name: "Simulated printer" },
    cameras: [{ id: "sim-cam-1", name: "Simulated camera", provider: "webcam" }],
    printers: [{ name: "Simulated printer", isDefault: true }],
  });
  interval = r.heartbeatIntervalSeconds ?? interval;
  if (r.configVersion !== applied) await syncConfig();
}

let stopped = false;
process.on("SIGINT", () => { stopped = true; log("stopping; the booth will show offline shortly"); process.exit(0); });
process.on("SIGTERM", () => process.exit(0));

log(`heartbeating to ${url} (Ctrl-C to stop)`);
while (!stopped) {
  try {
    await beat();
  } catch (e) {
    if (e.status === 401) { log("token rejected: this booth was revoked or re-enrolled. Delete the state file and enroll again."); process.exit(2); }
    log(`heartbeat failed (${e.message}); retrying`); // offline is normal: keep trying
  }
  await new Promise((r) => setTimeout(r, interval * 1000));
}
