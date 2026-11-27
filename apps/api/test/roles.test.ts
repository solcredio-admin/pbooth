import { describe, expect, it } from "vitest";
import { call, login, newEvent } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;
const PW = "a-long-test-password";

async function signIn(username: string, ip: string, password = PW) {
  const r = await call("/auth/login", { method: "POST", body: { username, password }, ip });
  return r.status === 200 ? r.setCookie!.split(";")[0] : null;
}

describe.skipIf(!url)("users and roles", () => {
  it("each role can do its job and nothing else (the table in docs/ROADMAP.md 12.3)", async () => {
    const IP = "10.0.20.1";
    const owner = await login(IP);
    const O = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie: owner, ip: IP, ...init });
    const stamp = Date.now();
    let n = 2;
    const as = async (role: string) => {
      const u = (await O("/users", { method: "POST", body: { username: `${role.toLowerCase()}-${stamp}`, password: PW, role } })).body;
      const ip = `10.0.20.${n++}`, cookie = (await signIn(u.username, ip))!;
      return Object.assign((path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie, ip, ...init }), { id: u.id as string, ip, cookie });
    };
    const [SA, EV, HW, SL, KI, CA] = [await as("SUPER_ADMIN"), await as("EVENTS"), await as("BOOTHS"), await as("SALES"), await as("KIOSK"), await as("CASHIER")];
    const ev = (await O("/events", { method: "POST", body: { ...newEvent, name: `Roles ${stamp}`, kind: "SELF_SERVICE" } })).body;
    const other = (await O("/events", { method: "POST", body: { ...newEvent, name: `Other ${stamp}` } })).body;
    const booth = (await O("/booths", { method: "POST", body: { name: `Roles booth ${stamp}` } })).body;
    const elsewhere = (await O("/booths", { method: "POST", body: { name: `Elsewhere ${stamp}` } })).body;
    await O(`/events/${ev.id}/booths`, { method: "POST", body: { boothId: booth.id } });
    await O(`/events/${other.id}/booths`, { method: "POST", body: { boothId: elsewhere.id } });
    const st = async (f: typeof O, path: string, init: Parameters<typeof call>[1] = {}) => (await f(path, init)).status;
    const ok = (s: number) => s < 300;

    // users and roles: the owner only; settings: owner and super admin
    expect(ok(await st(SA, "/users"))).toBe(true); // to pick people for events
    expect(await st(SA, "/users", { method: "POST", body: { username: `x-${stamp}`, password: PW, role: "EVENTS" } })).toBe(403);
    expect(await st(SA, `/users/${EV.id}`, { method: "PATCH", body: { role: "SALES" } })).toBe(403);
    for (const f of [EV, HW, SL, KI, CA]) expect(await st(f, "/users")).toBe(403);
    for (const path of ["/backups", "/alerts", "/storage/status", "/audit"]) {
      expect(ok(await st(SA, path)), path).toBe(true);
      for (const f of [EV, HW, SL, KI, CA]) expect(await st(f, path), path).toBe(403);
    }

    // events: owner, super and event admins manage; hardware and sales admins see
    expect(ok(await st(SA, `/events/${ev.id}`, { method: "PATCH", body: { venueName: "Hall B" } }))).toBe(true);
    expect(ok(await st(EV, `/events/${ev.id}`, { method: "PATCH", body: { venueName: "Hall C" } }))).toBe(true);
    for (const f of [HW, SL, CA]) expect(await st(f, `/events/${ev.id}`, { method: "PATCH", body: { venueName: "x" } })).toBe(403);
    for (const f of [HW, SL]) expect(ok(await st(f, `/events/${ev.id}`))).toBe(true);
    expect(await st(HW, "/events", { method: "POST", body: { ...newEvent, name: "nope" } })).toBe(403);

    // booths and stations: hardware admins manage; event and sales admins see
    expect(ok(await st(HW, `/booths/${booth.id}`, { method: "PATCH", body: { notes: "by the stage" } }))).toBe(true);
    for (const f of [EV, SL]) {
      expect(ok(await st(f, `/booths/${booth.id}`))).toBe(true);
      expect(ok(await st(f, "/stations"))).toBe(true);
      expect(await st(f, `/booths/${booth.id}`, { method: "PATCH", body: { notes: "x" } })).toBe(403);
      expect(await st(f, "/stations", { method: "POST", body: { name: "x" } })).toBe(403);
    }
    expect(ok(await st(EV, `/events/${other.id}/booths`, { method: "POST", body: { boothId: booth.id } }))).toBe(true); // booking, not managing

    // sales: owner, super and sales admins; event admins keep vouchers, not money
    for (const f of [SA, SL]) { expect(ok(await st(f, "/transactions"))).toBe(true); expect(ok(await st(f, `/events/${ev.id}/revenue`))).toBe(true); expect(ok(await st(f, "/refunds"))).toBe(true); }
    for (const f of [EV, HW, KI]) { expect(await st(f, "/transactions")).toBe(403); expect(await st(f, "/refunds")).toBe(403); }
    expect(await st(EV, `/events/${ev.id}/revenue`)).toBe(403);
    expect(ok(await st(EV, `/events/${ev.id}/vouchers`, { method: "POST", body: { kind: "ONE_TIME", count: 1 } }))).toBe(true);
    expect(ok(await st(SL, `/events/${ev.id}/vouchers`))).toBe(true);
    expect(await st(SL, `/events/${ev.id}/vouchers`, { method: "POST", body: { kind: "ONE_TIME", count: 1 } })).toBe(403);
    expect(ok(await st(SA, `/events/${ev.id}/vouchers`, { method: "POST", body: { kind: "UNLIMITED" } }))).toBe(true);

    // kiosk admins: nothing until assigned, then only those events and their booths, to open the kiosk
    expect((await KI("/events")).body.items).toHaveLength(0);
    expect((await KI("/booths")).body.items).toHaveLength(0);
    expect(await st(KI, `/booths/${booth.id}/kiosk/launch`, { method: "POST" })).toBe(404);
    expect(await st(EV, `/events/${ev.id}/kiosk-admins`, { method: "PUT", body: { adminIds: [KI.id] } })).toBe(403);
    expect((await SA(`/events/${ev.id}/kiosk-admins`, { method: "PUT", body: { adminIds: [KI.id, EV.id] } })).body.kioskAdmins).toEqual([{ id: KI.id, username: `kiosk-${stamp}` }]);
    expect((await KI("/events")).body.items.map((e: { id: string }) => e.id)).toEqual([ev.id]);
    expect((await KI("/booths")).body.items.map((b: { id: string }) => b.id)).toEqual([booth.id]);
    expect(await st(KI, `/booths/${elsewhere.id}`)).toBe(404);
    expect(await st(KI, `/events/${other.id}`)).toBe(404);
    const launched = await KI(`/booths/${booth.id}/kiosk/launch`, { method: "POST" });
    expect(launched.status).toBe(200);
    expect((await call(`/kiosk/config?booth=${booth.code}`, { cookie: launched.setCookie!.split(";")[0], ip: KI.ip })).status).toBe(200);
    expect(await st(KI, `/booths/${elsewhere.id}/kiosk/launch`, { method: "POST" })).toBe(404);
    expect(await st(KI, `/booths/${booth.id}/kiosk-code`, { method: "POST" })).toBe(403);
    expect(ok(await st(HW, `/booths/${elsewhere.id}/kiosk/launch`, { method: "POST" }))).toBe(true);
    expect(await st(EV, `/booths/${booth.id}/kiosk/launch`, { method: "POST" })).toBe(403);

    // cashiers: only their assigned event's vouchers, sales and help requests
    await SA(`/events/${ev.id}/cashiers`, { method: "PUT", body: { adminIds: [CA.id] } });
    expect(ok(await st(CA, `/events/${ev.id}/revenue`))).toBe(true);
    expect(await st(CA, `/events/${other.id}`)).toBe(404);
    expect(await st(CA, "/booths")).toBe(403);
    expect(await st(CA, `/events/${ev.id}/activate`, { method: "POST" })).toBe(403);
  }, 60_000);

  it("disabling or changing a user takes effect at once, and you can't lock yourself out", async () => {
    const owner = await login("10.0.21.1");
    const O = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie: owner, ip: "10.0.21.1", ...init });
    const me = (await O("/auth/me")).body.admin;
    const u = (await O("/users", { method: "POST", body: { username: `temp-${Date.now()}`, password: PW, role: "EVENTS" } })).body;
    const session = (await signIn(u.username, "10.0.21.2"))!;
    expect((await call("/events", { cookie: session, ip: "10.0.21.2" })).status).toBe(200);

    expect((await O(`/users/${u.id}`, { method: "PATCH", body: { disabled: true } })).status).toBe(200);
    expect((await call("/events", { cookie: session, ip: "10.0.21.2" })).status).toBe(401); // signed out now
    expect(await signIn(u.username, "10.0.21.2")).toBeNull(); // and can't sign back in
    await O(`/users/${u.id}`, { method: "PATCH", body: { disabled: false, role: "KIOSK" } });
    const again = (await signIn(u.username, "10.0.21.2"))!;
    expect((await call("/events", { method: "POST", cookie: again, ip: "10.0.21.2", body: newEvent })).status).toBe(403); // new role applies

    // guard rails
    expect((await O(`/users/${me.id}`, { method: "PATCH", body: { disabled: true } })).body.error.code).toBe("SELF_LOCKOUT");
    expect((await O(`/users/${me.id}`, { method: "PATCH", body: { role: "EVENTS" } })).body.error.code).toBe("SELF_LOCKOUT");
    expect((await O(`/users/${me.id}`, { method: "DELETE" })).body.error.code).toBe("SELF_LOCKOUT");
    expect((await O("/users", { method: "POST", body: { username: "x", password: PW, role: "EVENTS" } })).status).toBe(400); // too short
    expect((await O("/users", { method: "POST", body: { username: "weakling", password: "short", role: "EVENTS" } })).body.error.code).toBe("WEAK_PASSWORD");
    expect((await O("/users", { method: "POST", body: { username: u.username, password: PW, role: "EVENTS" } })).body.error.code).toBe("USERNAME_TAKEN");

    expect((await O(`/users/${u.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await signIn(u.username, "10.0.21.2")).toBeNull();
    const list = (await O("/users")).body.items as { username: string }[];
    expect(list.some((x) => x.username === u.username)).toBe(false);
  });
});
