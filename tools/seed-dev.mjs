#!/usr/bin/env node
// Fills the development stack with believable test data: one account per role, events in every state, booths,
// stations, finished sessions with photos, vouchers, a help request, a frame and a print in line.
//   node tools/seed-dev.mjs https://pbooth-dev.ts.solcredio.net
// Development only. Test accounts: admin@test.local / correct-horse-battery (owner, made with admin:create);
// the others are <role>@test.local / a-long-test-password.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const sharp = createRequire(new URL("../apps/agent/package.json", import.meta.url))("sharp");

const BASE = process.argv[2] ?? "https://pbooth-dev.ts.solcredio.net";
const PW = "a-long-test-password";
const api = async (path, { method = "GET", body, cookie, token, raw, type } = {}) => {
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: { origin: BASE, ...(body || raw ? { "content-type": type ?? "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: raw ?? (body && JSON.stringify(body)) });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json)}`);
  return { json, cookie: r.headers.get("set-cookie")?.split(";")[0] };
};
const { cookie } = await api("/auth/login", { method: "POST", body: { username: "admin@test.local", password: "correct-horse-battery" } });
const O = async (path, method = "GET", body) => (await api(path, { method, body, cookie })).json;
const today = new Date().toISOString().slice(0, 10), later = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);

const users = {};
for (const role of ["SUPER_ADMIN", "EVENTS", "BOOTHS", "SALES", "KIOSK", "CASHIER"]) {
  const username = `${role.toLowerCase().replace("_", "-")}@test.local`;
  users[role] = await O("/users", "POST", { username, password: PW, role }).catch(async () => (await O("/users")).items.find((u) => u.username === username));
}

const event = (name, extra) => O("/events", "POST", { name, date: today, startTime: "00:00", endTime: "23:59", timeZone: "Asia/Manila", ...extra });
const wedding = await event("Reyes Wedding", { organizerName: "Ana Reyes", contactPhone: "+63 917 123 4567", venueName: "Casa Loma", config: { layout: "strip", shotsPerSession: 3, printEnabled: true, primaryColor: "#f3e3d3", accentColor: "#7a1f2b", footerText: "Ana & Miguel" } });
const cafe = await event("Kape Tayo Café", { kind: "SELF_SERVICE", priceCentavos: 15000, partnerName: "Kape Tayo", partnerSharePercent: 20, config: { layout: "landscape", shotsPerSession: 2, printEnabled: true, primaryColor: "#1b1730", accentColor: "#c6f36b" } });
const gala = await event("Solcredio Year-End Gala", { date: later, startTime: "18:00", endTime: "23:00", config: { layout: "grid", shotsPerSession: 4 } });
await event("Santos Debut", { date: later, startTime: "17:00", endTime: "22:00" });
const done = await event("Dela Cruz Christening", { config: { layout: "landscape", shotsPerSession: 1 } });

const booth = async (name) => (await O("/booths", "POST", { name }));
const [A, B, C] = [await booth("Booth A · Mirror"), await booth("Booth B · Café"), await booth("Booth C · Spare")];
await O(`/events/${wedding.id}/booths`, "POST", { boothId: A.id });
await O(`/events/${cafe.id}/booths`, "POST", { boothId: B.id });
await O(`/events/${gala.id}/booths`, "POST", { boothId: C.id });
await O(`/events/${done.id}/booths`, "POST", { boothId: C.id });
await O(`/events/${done.id}/activate`, "POST");
for (const e of [wedding, cafe]) await O(`/events/${e.id}/activate`, "POST");
await O(`/events/${gala.id}/schedule`, "POST");
await O(`/events/${cafe.id}/cashiers`, "PUT", { adminIds: [users.CASHIER.id] });
await O(`/events/${wedding.id}/kiosk-admins`, "PUT", { adminIds: [users.KIOSK.id] });

// a simulated agent on Booth A, kiosks on A and B
const { code: ac } = await O(`/booths/${A.id}/enrollment-code`, "POST");
const agent = (await api("/devices/enroll", { method: "POST", body: { code: ac, simulated: true, stations: true, device: { identifier: "dev-mirror", hostname: "mirror-booth", os: "Linux", agentVersion: "0.5.1" } } })).json;
await api("/devices/heartbeat", { method: "POST", token: agent.token, body: { agentVersion: "0.5.1", camera: { status: "connected", name: "Canon EOS R50", compatibility: "simulated" }, printer: { status: "connected", name: "DNP DS620" }, printers: [{ name: "DNP DS620", isDefault: true }], storage: { freeBytes: 182e9, totalBytes: 256e9 } } });
const kiosk = async (b) => { const { code } = await O(`/booths/${b.id}/kiosk-code`, "POST"); return (await api("/kiosk/pair", { method: "POST", body: { boothCode: b.code, code } })).cookie; };
const [kA, kB] = [await kiosk(A), await kiosk(B)];
const K = async (k, path, method = "GET", body) => (await api(path, { method, body, cookie: k })).json;

// stations: the front desk is connected (simulated); the back room isn't yet
const front = await O("/stations", "POST", { name: "Front desk" });
const back = await O("/stations", "POST", { name: "Back room" });
const { code: sc } = await O(`/stations/${front.id}/enrollment-code`, "POST");
const st = (await api("/devices/enroll", { method: "POST", body: { code: sc, simulated: true, stations: true, device: { identifier: "dev-desk", hostname: "front-desk-pc", os: "macOS", agentVersion: "0.5.1" } } })).json;
await O(`/booths/${A.id}/stations`, "PUT", { stationIds: [front.id, back.id] });
await O(`/booths/${B.id}/stations`, "PUT", { stationIds: [front.id] });

// finished sessions with designs
const jpeg = (w, h, hue, label) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,70%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},40%,42%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w / 2}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.16}" fill="#fff" opacity=".55"/><text x="50%" y="${h * 0.9}" font-family="Georgia" font-size="${Math.min(w, h) * 0.07}" fill="#fff" text-anchor="middle">${label}</text></svg>`)).jpeg({ quality: 85 }).toBuffer();
async function session(k, design, payment) {
  const id = randomUUID(), photoId = randomUUID();
  await K(k, "/sessions", "POST", { id, galleryToken: randomBytes(32).toString("base64url"), ...(payment ? { paymentId: payment } : {}) });
  const sha256 = createHash("sha256").update(design).digest("hex");
  const a = await K(k, "/photos/upload-authorize", "POST", { photoId, sessionId: id, kind: "DESIGN", index: 0, sha256, size: design.length, contentType: "image/jpeg" });
  const put = await fetch(a.url, { method: "PUT", body: design, headers: a.headers });
  if (!put.ok) throw new Error(`upload ${put.status}: ${await put.text()}`);
  await K(k, "/photos/upload-complete", "POST", { photoId });
  await K(k, `/sessions/${id}/status`, "PATCH", { status: "COMPLETED", photoCount: 1, retakeCount: 0 });
  return { id, photoId };
}
const wed = [];
for (let i = 0; i < 6; i++) wed.push(await session(kA, await jpeg(600, 1800, i * 47, "Ana &amp; Miguel")));
const voucher = async () => { const { codes } = await O(`/events/${cafe.id}/vouchers`, "POST", { kind: "ONE_TIME", count: 1 }); return (await K(kB, "/kiosk/redeem", "POST", { code: codes[0] })).paymentId; };
for (let i = 0; i < 5; i++) await session(kB, await jpeg(1800, 1200, 200 + i * 30, "Kape Tayo"), await voucher());
await O(`/events/${cafe.id}/vouchers`, "POST", { kind: "ONE_TIME", count: 12, label: "Counter batch" });
const lost = await voucher();
await K(kB, "/kiosk/help", "POST", { reason: "NO_PRINT", paymentId: lost });

// a print in line at the front desk, and one printed
await K(kA, "/kiosk/prints", "POST", { sessionId: wed[0].id, photoId: wed[0].photoId, strip: true });
await K(kA, "/kiosk/prints", "POST", { sessionId: wed[1].id, photoId: wed[1].photoId, strip: true });
const [j] = (await api("/station/poll", { method: "POST", token: st.token, body: { ready: true, printers: [{ name: "Canon G1010", isDefault: true }] } })).json.jobs;
if (j) { await api(`/station/jobs/${j.id}`, { method: "POST", token: st.token, body: { attempt: j.attempt, status: "PRINTING" } }); await api(`/station/jobs/${j.id}`, { method: "POST", token: st.token, body: { attempt: j.attempt, status: "DONE" } }); }

// the owner's own frame for the wedding's strip
// the strip's photo spots (web lib/template/layout.ts: 3 photos on 600 x 1800)
const holes = [0, 1, 2].map((i) => `<rect x="40" y="${40 + i * 497}" width="520" height="475" fill="black"/>`).join("");
const frame = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800"><defs><mask id="m"><rect width="600" height="1800" fill="white"/>${holes}</mask></defs><rect width="600" height="1800" fill="#7a1f2b" mask="url(#m)"/><text x="300" y="1700" font-family="Georgia" font-size="64" fill="#f3e3d3" text-anchor="middle">Ana &amp; Miguel</text></svg>`)).png().toBuffer();
await api(`/events/${wedding.id}/frames/strip/3`, { method: "PUT", raw: frame, type: "image/png", cookie });
await O(`/events/${wedding.id}/gallery`, "POST");
await O(`/events/${done.id}/complete`, "POST");
console.log(`seeded ${BASE}: events ${wedding.id} (managed), ${cafe.id} (self-service); booths ${A.code} ${B.code} ${C.code}`);
