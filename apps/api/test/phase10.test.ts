import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, inject, it } from "vitest";
import { base, call, login, newEvent } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;
const PW = "a-long-test-password";
const auth = { authorization: `Basic ${Buffer.from("sk_test_mock:").toString("base64")}` };
const fake = (path: string, method = "GET") => fetch(`${inject("paymongo")}${path}`, { method, headers: auth }).then((r) => r.json());
const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000) => {
  for (const end = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 250))) { const v = await get(); if (ok(v)) return v; if (Date.now() > end) throw new Error(`timed out: ${JSON.stringify(v).slice(0, 400)}`); }
};

async function cafe(ip: string, extra: object = {}) {
  const owner = await login(ip);
  const O = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie: owner, ip, ...init });
  const name = `Ref café ${randomUUID().slice(0, 8)}`;
  const ev = (await O("/events", { method: "POST", body: { ...newEvent, name, kind: "SELF_SERVICE", priceCentavos: 15000, partnerSharePercent: 20, ...extra } })).body;
  const booth = (await O("/booths", { method: "POST", body: { name: `Booth ${name}` } })).body;
  await O(`/events/${ev.id}/booths`, { method: "POST", body: { boothId: booth.id } });
  await O(`/events/${ev.id}/activate`, { method: "POST" });
  const { code } = (await O(`/booths/${booth.id}/kiosk-code`, { method: "POST" })).body;
  const kiosk = (await call("/kiosk/pair", { method: "POST", ip, body: { boothCode: booth.code, code } })).setCookie!.split(";")[0];
  const K = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie: kiosk, ip, ...init });
  const qr = async () => {
    const q = (await K("/kiosk/payments/qr", { method: "POST" })).body;
    await fetch(`${inject("paymongo")}/test/pay/${await latest()}`, { method: "POST", headers: auth });
    expect((await K(`/kiosk/payments/${q.paymentId}`)).body.status).toBe("PAID");
    return q as { paymentId: string; reference: string };
  };
  const voucher = async () => {
    const { codes } = (await O(`/events/${ev.id}/vouchers`, { method: "POST", body: { kind: "ONE_TIME", count: 1 } })).body;
    return (await K("/kiosk/redeem", { method: "POST", body: { code: codes[0] } })).body as { paymentId: string; reference: string };
  };
  const requests = async (status = "open") => (await O(`/refunds?eventId=${ev.id}&status=${status}`)).body.items as { id: string; status: string; reason: string; link: string | null; note: string | null; payment: { reference: string; status: string } | null }[];
  const resolve = (id: string, action: string, as = O) => as(`/refunds/${id}/resolve`, { method: "POST", body: { action } });
  const revenue = async () => (await O(`/events/${ev.id}/revenue`)).body.all.amountCentavos as number;
  return { O, K, ev, booth, name, qr, voucher, requests, resolve, revenue };
}
const latest = async () => { for (let i = 1; ; i++) { const r = await fetch(`${inject("paymongo")}/v1/payment_intents/pi_${i}`, { headers: auth }); if (!r.ok) return `pi_${i - 1}`; } };

describe.skipIf(!url)("phase 10: references, help and refunds, alerts, transactions, staff PIN", () => {
  it("a guest asks for help by reference; the owner refunds a QR payment through PayMongo exactly once", async () => {
    const c = await cafe("10.0.40.1");
    const p = await c.qr();
    expect(p.reference).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect((await c.K("/kiosk/help")).body.items).toEqual([expect.objectContaining({ id: p.paymentId, amountCentavos: 15000 })]);
    expect((await c.K("/kiosk/help", { method: "POST", body: { reason: "OTHER", reference: "ZZZZ-ZZZZ" } })).body.error.code).toBe("UNKNOWN_REFERENCE");
    expect((await c.K("/kiosk/help", { method: "POST", body: { reason: "NO_PRINT", reference: p.reference.toLowerCase().replace("-", " ") } })).body).toEqual({ reference: p.reference });
    await c.K("/kiosk/help", { method: "POST", body: { reason: "OTHER", paymentId: p.paymentId } }); // asking twice is one request
    const [r] = await c.requests();
    expect(await c.requests()).toHaveLength(1);
    expect(r).toMatchObject({ status: "OPEN", reason: "NO_PRINT", payment: { reference: p.reference } });
    expect(await c.revenue()).toBe(15000);

    // PayMongo refuses: nothing was sent, the request and the money are back as they were
    await fake("/test/refuse/400", "POST");
    expect((await c.resolve(r.id, "PAYMONGO")).body.error.message).toContain("insufficient balance");
    expect((await c.requests())[0]).toMatchObject({ status: "OPEN", payment: { status: "PAID" } });
    expect(await c.revenue()).toBe(15000);

    // two clicks at once: one refund, for the whole amount of that payment
    const sent = (await fake("/test/refunds")).length;
    const both = await Promise.all([c.resolve(r.id, "PAYMONGO"), c.resolve(r.id, "PAYMONGO")]);
    expect(both.map((x) => x.status).sort()).toEqual([200, 409]);
    const all = await fake("/test/refunds");
    expect(all).toHaveLength(sent + 1);
    const ref = all.at(-1);
    expect(ref).toMatchObject({ amount: 15000, key: r.id });
    expect((await c.requests())[0]).toMatchObject({ status: "PROCESSING", link: `https://pm.example/claim/${ref.id}`, payment: { status: "REFUNDED" } });
    expect(await c.revenue()).toBe(0); // reports subtract it at once
    const start = await c.K("/sessions", { method: "POST", body: { id: randomUUID(), galleryToken: randomBytes(32).toString("base64url"), paymentId: p.paymentId } });
    expect(start.body.error.code).toBe("PAYMENT_REQUIRED"); // a refunded payment can't start a session
    await fake(`/test/refund/${ref.id}/succeeded`, "POST");
    await until(() => c.requests("done"), (x) => x[0]?.status === "REFUNDED");
    expect((await c.resolve(r.id, "MANUAL")).status).toBe(409);
  }, 30_000);

  it("a refund with no answer can be retried without paying twice; one the guest never claims opens again", async () => {
    const c = await cafe("10.0.40.2");
    const p = await c.qr();
    await c.K("/kiosk/help", { method: "POST", body: { reason: "NO_SESSION", reference: p.reference } });
    const [r] = await c.requests();
    await fake("/test/refuse/502", "POST");
    expect((await c.resolve(r.id, "PAYMONGO")).body.error.code).toBe("PAYMENT_PROVIDER_DOWN");
    expect((await c.requests())[0]).toMatchObject({ status: "PROCESSING", payment: { status: "REFUNDED" } }); // unknown: held, not paid back some other way
    expect((await c.resolve(r.id, "MANUAL")).status).toBe(409);
    expect((await c.resolve(r.id, "PAYMONGO")).status).toBe(409); // not while the first try may still be on its way

    const c2 = await cafe("10.0.40.3");
    const p2 = await c2.qr();
    await c2.K("/kiosk/help", { method: "POST", body: { reason: "OTHER", reference: p2.reference } });
    const [r2] = await c2.requests();
    expect((await c2.resolve(r2.id, "PAYMONGO")).status).toBe(200);
    await fake(`/test/refund/${(await fake("/test/refunds")).at(-1).id}/failed`, "POST");
    await until(() => c2.requests(), (x) => x[0]?.status === "OPEN" && x[0].payment?.status === "PAID");
    expect(await c2.revenue()).toBe(15000);
  }, 30_000);

  it("cashiers give a replacement voucher (₱0, once) for their own events, and can't refund money", async () => {
    const c = await cafe("10.0.40.4");
    const u = `cash-${randomUUID().slice(0, 6)}`;
    const made = (await c.O("/users", { method: "POST", body: { username: u, password: PW, role: "CASHIER" } })).body;
    const cookie = (await call("/auth/login", { method: "POST", ip: "10.0.40.5", body: { username: u, password: PW } })).setCookie!.split(";")[0];
    const C = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie, ip: "10.0.40.5", ...init });
    const p = await c.voucher();
    await c.K("/kiosk/help", { method: "POST", body: { reason: "NO_PRINT", reference: p.reference } });
    const [r] = await c.requests();
    expect((await C("/refunds")).body.items).toEqual([]); // not their event yet
    expect((await c.resolve(r.id, "VOUCHER", C)).status).toBe(404);
    await c.O(`/events/${c.ev.id}/cashiers`, { method: "PUT", body: { adminIds: [made.id ?? made.user?.id] } });
    expect((await C("/refunds")).body.items).toHaveLength(1);
    for (const money of ["MANUAL", "PAYMONGO"]) expect((await c.resolve(r.id, money, C)).status).toBe(403);
    const given = (await c.resolve(r.id, "VOUCHER", C)).body;
    expect((await c.resolve(r.id, "VOUCHER", C)).status).toBe(409);
    expect((await c.K("/kiosk/redeem", { method: "POST", body: { code: given.code } })).body.complimentary).toBe(true);
    expect((await c.K("/kiosk/redeem", { method: "POST", body: { code: given.code } })).body.error.code).toBe("INVALID_VOUCHER");
    expect(await c.revenue()).toBe(15000); // the first sale only
    expect((await C("/alerts")).status).toBe(403);
    expect((await C(`/transactions?eventId=${c.ev.id}`)).body.total).toBe(2);
    expect((await C("/transactions")).body.items.every((t: { event: string }) => t.event === c.name)).toBe(true);
  }, 30_000);

  it("a paid session that makes no photos is flagged by itself, once; Telegram hears about it, and about a booth going silent and coming back", async () => {
    const c = await cafe("10.0.40.6");
    const A = (path: string, method = "GET", body?: unknown) => c.O(`/alerts${path}`, { method, body });
    expect((await A("")).body).toMatchObject({ enabled: true, bot: { username: "pbooth_test_bot" } });
    expect(JSON.stringify((await A("")).body)).not.toContain("xxxxx"); // the bot's token never leaves the server
    expect((await A("/find-chats")).body.items).toContainEqual({ chatId: "-100777", label: "Café staff" });
    const chat = (await A("/chats", "POST", { chatId: "4242", label: "Owner" })).body;
    const blocked = (await A("/chats", "POST", { chatId: "666", label: "Blocked" })).body;
    expect((await A(`/chats/${chat.id}/test`, "POST")).status).toBe(200);
    expect((await A(`/chats/${blocked.id}/test`, "POST")).body.error.message).toContain("blocked");

    const p = await c.voucher();
    const beat = () => c.K("/kiosk/heartbeat", { method: "POST", body: {} });
    const sent = async () => ((await fake("/test/telegram")) as { chat: string; text: string }[]).filter((m) => m.chat === "4242" && m.text.includes(c.name));
    const alive = setInterval(() => void beat(), 1000);
    const flagged = await until(() => c.requests(), (x) => x.length > 0, 25_000).finally(() => clearInterval(alive));
    expect(flagged).toEqual([expect.objectContaining({ reason: "SESSION_FAILED", payment: expect.objectContaining({ reference: p.reference }) })]);
    await until(sent, (m) => m.some((x) => x.text.includes(p.reference)));
    // no more heartbeats: offline, then back
    const off = await until(sent, (m) => m.some((x) => x.text.startsWith("🔴")), 20_000);
    await new Promise((r) => setTimeout(r, 2500));
    expect((await sent()).filter((x) => x.text.startsWith("🔴"))).toHaveLength(off.filter((x) => x.text.startsWith("🔴")).length); // said once
    await beat();
    await until(sent, (m) => m.some((x) => x.text.startsWith("✅")));
    expect(await c.requests()).toHaveLength(1);
    // a screen problem, with only the kinds this chat asked for
    await A(`/chats/${chat.id}`, "PATCH", { kinds: ["OFFLINE"] });
    const n = (await sent()).filter((x) => x.text.startsWith("🟠")).length;
    const bad = setInterval(() => void c.K("/kiosk/heartbeat", { method: "POST", body: { lastError: "Camera lost" } }), 700);
    await until(async () => (await A("")).body.recent as { kind: string; text: string }[], (x) => x.some((a) => a.kind === "KIOSK" && a.text.includes(c.name))).finally(() => clearInterval(bad));
    await new Promise((r) => setTimeout(r, 1500));
    expect((await sent()).filter((x) => x.text.startsWith("🟠"))).toHaveLength(n);
    for (const x of [chat, blocked]) await A(`/chats/${x.id}`, "DELETE");
  }, 90_000);

  it("transactions: filters, totals, search and a CSV that matches; formulas in names are defused", async () => {
    const c = await cafe("10.0.40.7");
    await c.O(`/events/${c.ev.id}`, { method: "PATCH", body: { name: "=Café, One" } });
    const a = await c.qr(), b = await c.voucher();
    await c.K("/kiosk/help", { method: "POST", body: { reason: "OTHER", reference: b.reference } });
    expect((await c.resolve((await c.requests())[0].id, "MANUAL")).status).toBe(200);
    const T = async (q = "") => (await c.O(`/transactions?eventId=${c.ev.id}${q}`)).body;
    expect((await T()).totals).toEqual({ sessions: 1, grossCentavos: 30000, refundsCentavos: 15000, netCentavos: 15000, partnerShareCentavos: 3000 });
    expect((await T("&method=QR")).items.map((x: { reference: string }) => x.reference)).toEqual([a.reference]);
    expect((await T("&status=REFUNDED")).items.map((x: { reference: string }) => x.reference)).toEqual([b.reference]);
    expect((await T(`&q=${a.reference.toLowerCase()}`)).total).toBe(1);
    expect((await T("&to=2020-01-01")).total).toBe(0);
    const get = async (q: string) => { const r = await fetch(`${base}/transactions/export.csv?eventId=${c.ev.id}${q}`, { headers: { cookie: await login("10.0.40.8"), "x-forwarded-for": "10.0.40.8" } }); return { type: r.headers.get("content-type"), text: await r.text() }; };
    const full = await get("");
    expect(full.type).toContain("text/csv");
    expect(full.text.trim().split("\r\n")).toHaveLength(3);
    expect(full.text).toContain(`"'=Café, One"`);
    expect(full.text).toContain(a.reference);
    expect((await get("&daily=1")).text).toMatch(/,1,300,150,150,30\r\n$/);
    expect((await call(`/transactions/export.csv`, { ip: "10.0.40.8" }).catch(() => ({ status: 401 }))).status).toBe(401);
  }, 30_000);

  it("the staff PIN opens the kiosk's menu, is never sent out, and can't be guessed", async () => {
    const c = await cafe("10.0.40.9");
    const tryPin = (pin: string) => c.K("/kiosk/staff", { method: "POST", body: { pin } });
    expect((await tryPin("1234")).status).toBe(403); // none set
    expect((await c.O(`/booths/${c.booth.id}/staff-pin`, { method: "POST", body: { pin: "12" } })).status).toBe(400);
    expect((await c.O(`/booths/${c.booth.id}/staff-pin`, { method: "POST", body: { pin: "482913" } })).body).toEqual({ staffMenu: true });
    const cfg = (await c.K(`/kiosk/config?booth=${c.booth.code}`)).body;
    expect(cfg.staffMenu).toBe(true);
    expect(JSON.stringify([cfg, (await c.O(`/booths/${c.booth.id}`)).body])).not.toContain("argon2");
    expect((await tryPin("482913")).status).toBe(200);
    expect((await tryPin("482914")).status).toBe(403);
    for (let i = 0; i < 8; i++) await tryPin("0000");
    expect((await tryPin("482913")).status).toBe(429);
  });
});
