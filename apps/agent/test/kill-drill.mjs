// Kill drill against a running dev stack: several booths, one printer, and an agent that is kill -9'd over
// and over. Every print must come out exactly once, or be left for staff; the line must always empty.
//   pnpm --filter @pbooth/agent build && node apps/agent/test/kill-drill.mjs http://localhost:3399
// Development only (mock data, the simulated printer).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const sharp = createRequire(new URL("../package.json", import.meta.url))("sharp");

const BASE = process.argv[2] ?? "http://localhost:3399", BOOTHS = 4, EACH = 5;
const USER = { username: process.env.E2E_USERNAME ?? "admin@test.local", password: process.env.E2E_PASSWORD ?? "correct-horse-battery" };
const main = new URL("../dist/main.js", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "pbooth-drill-"));
const env = { ...process.env, PBOOTH_AGENT_DIR: dir };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, { method = "GET", body, cookie } = {}) => {
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: { origin: new URL(BASE).origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body && JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);
  return { json, cookie: r.headers.get("set-cookie")?.split(";")[0] };
};
const { cookie } = await api("/auth/login", { method: "POST", body: USER });
const O = async (path, method = "GET", body) => (await api(path, { method, body, cookie })).json;

const station = await O("/stations", "POST", { name: `Drill ${Date.now()}` });
const { code } = await O(`/stations/${station.id}/enrollment-code`, "POST");
execFileSync("node", [main, "enroll", "--server", BASE, "--code", code, "--simulate"], { env, stdio: "ignore" });

const jobs = [];
const booths = [];
for (let i = 0; i < BOOTHS; i++) {
  const b = await O("/booths", "POST", { name: `Drill booth ${i + 1}` });
  const ev = await O("/events", "POST", { name: `Drill ${b.code}`, date: "2026-12-05", startTime: "08:00", endTime: "20:00", timeZone: "Asia/Manila", config: { printEnabled: true } });
  await O(`/events/${ev.id}/booths`, "POST", { boothId: b.id });
  await O(`/events/${ev.id}/activate`, "POST");
  await O(`/booths/${b.id}/stations`, "PUT", { stationIds: [station.id] });
  const k = await O(`/booths/${b.id}/kiosk-code`, "POST");
  booths.push({ ...b, ev, kiosk: (await api("/kiosk/pair", { method: "POST", body: { boothCode: b.code, code: k.code } })).cookie });
}

let alive, kills = 0, stop = false;
const start = () => { alive = spawn("node", ["--disable-warning=ExperimentalWarning", main, "run"], { env, stdio: "ignore" }); };
start();
const killer = (async () => { while (!stop) { await wait(400 + Math.random() * 4500); if (stop) break; alive.kill("SIGKILL"); kills++; await wait(Math.random() * 2500); start(); } })();

const file = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#345" } }).jpeg().toBuffer();
const sha256 = createHash("sha256").update(file).digest("hex");
const K = async (b, path, method, body) => (await api(path, { method, body, cookie: b.kiosk })).json;
for (let n = 0; n < EACH; n++) await Promise.all(booths.map(async (b) => {
  const id = randomUUID(), photoId = randomUUID();
  await K(b, "/sessions", "POST", { id, galleryToken: randomBytes(32).toString("base64url") });
  const a = await K(b, "/photos/upload-authorize", "POST", { photoId, sessionId: id, kind: "DESIGN", index: 0, sha256, size: file.length, contentType: "image/jpeg" });
  const put = await fetch(a.url, { method: "PUT", body: file, headers: a.headers });
  if (!put.ok) throw new Error(`upload ${put.status}`);
  await K(b, "/photos/upload-complete", "POST", { photoId });
  await Promise.all([K(b, "/kiosk/prints", "POST", { sessionId: id, photoId }), K(b, "/kiosk/prints", "POST", { sessionId: id, photoId })]);
  jobs.push({ id, booth: b });
}));

const t0 = Date.now();
let states;
for (;;) {
  states = await Promise.all(jobs.map((j) => K(j.booth, `/kiosk/prints/${j.id}`, "GET").then((s) => s.status)));
  const left = states.filter((s) => !["DONE", "FAILED", "EXPIRED"].includes(s)).length;
  console.log(`${Math.round((Date.now() - t0) / 1000)} s: ${left} left, ${kills} kills`);
  if (!left) break;
  if (Date.now() - t0 > 15 * 60_000) throw new Error("the line got stuck");
  await wait(5000);
}
stop = true; await killer; alive.kill("SIGKILL");
const printed = readFileSync(join(dir, "simulated-prints/prints.log"), "utf8").trim().split("\n");
const twice = printed.filter((x, i) => printed.indexOf(x) !== i);
const count = (s) => states.filter((x) => x === s).length;
const lost = jobs.filter((j, i) => states[i] === "DONE" && !printed.includes(`pbooth-${j.id}`));
console.log(`${jobs.length} prints, ${kills} kills: ${count("DONE")} printed, ${count("FAILED")} left for staff, ${count("EXPIRED")} expired; printed twice: ${twice.length}, said printed but wasn't: ${lost.length}`);
for (const b of booths) { await O(`/events/${b.ev.id}/complete`, "POST").catch((e) => console.log(e.message)); await O(`/booths/${b.id}/delete`, "POST", { confirmName: b.name }).catch((e) => console.log(e.message)); }
await O(`/stations/${station.id}/delete`, "POST", { confirmName: station.name });
process.exit(twice.length || lost.length || count("EXPIRED") ? 1 : 0);
