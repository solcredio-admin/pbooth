import { describe, expect, it } from "vitest";
import { call, login, newEvent } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;
const PW = "a-long-test-password";

async function signIn(username: string, ip: string, password = PW) {
  const r = await call("/auth/login", { method: "POST", body: { username, password }, ip });
  return r.status === 200 ? r.setCookie!.split(";")[0] : null;
}

describe.skipIf(!url)("users and roles", () => {
  it("each role can do its job and nothing else", async () => {
    const owner = await login("10.0.20.1");
    const stamp = Date.now();
    const mk = async (role: string) => {
      const r = await call("/users", { method: "POST", cookie: owner, ip: "10.0.20.1", body: { username: `${role.toLowerCase()}-${stamp}`, password: PW, role } });
      expect(r.status).toBe(201);
      return r.body;
    };
    const [ev, bo, ki] = [await mk("EVENTS"), await mk("BOOTHS"), await mk("KIOSK")];
    const events = (await signIn(ev.username, "10.0.20.2"))!;
    const booths = (await signIn(bo.username, "10.0.20.3"))!;
    const kiosk = (await signIn(ki.username, "10.0.20.4"))!;
    expect((await call("/auth/me", { cookie: kiosk, ip: "10.0.20.4" })).body.admin.role).toBe("KIOSK");

    const as = (cookie: string, ip: string) => (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie, ip, ...init });
    const E = as(events, "10.0.20.2"), B = as(booths, "10.0.20.3"), K = as(kiosk, "10.0.20.4"), O = as(owner, "10.0.20.1");

    // events admin: makes and runs events; can't touch booths, users, backups or storage
    const event = (await E("/events", { method: "POST", body: { ...newEvent, name: `Roles ${stamp}` } }));
    expect(event.status).toBe(201);
    expect((await E(`/events/${event.body.id}`, { method: "PATCH", body: { venueName: "Hall B" } })).status).toBe(200);
    expect((await E("/booths", { method: "POST", body: { name: "nope" } })).status).toBe(403);
    expect((await E("/users")).status).toBe(403);
    expect((await E("/backups")).status).toBe(403);
    expect((await E("/storage/status")).status).toBe(403);

    // booth admin: manages booths, sees events but can't change them
    const booth = await B("/booths", { method: "POST", body: { name: `Roles booth ${stamp}` } });
    expect(booth.status).toBe(201);
    expect((await B(`/booths/${booth.body.id}`, { method: "PATCH", body: { notes: "by the stage" } })).status).toBe(200);
    expect((await B(`/events/${event.body.id}`)).status).toBe(200);
    expect((await B(`/events/${event.body.id}`, { method: "PATCH", body: { venueName: "x" } })).status).toBe(403);
    expect((await B(`/events/${event.body.id}/activate`, { method: "POST" })).status).toBe(403);
    expect((await B(`/events/${event.body.id}/booths`, { method: "POST", body: { boothId: booth.body.id } })).status).toBe(200);
    expect((await B("/users")).status).toBe(403);

    // kiosk operator: sees events and booths, changes nothing, can only open a kiosk
    expect((await K("/events")).status).toBe(200);
    expect((await K(`/events/${event.body.id}`)).status).toBe(200);
    expect((await K("/booths")).status).toBe(200);
    expect((await K(`/booths/${booth.body.id}`)).status).toBe(200);
    expect((await K(`/events/${event.body.id}/booths`)).status).toBe(200);
    expect((await K("/events", { method: "POST", body: { ...newEvent, name: "nope" } })).status).toBe(403);
    expect((await K(`/booths/${booth.body.id}`, { method: "PATCH", body: { notes: "x" } })).status).toBe(403);
    expect((await K(`/booths/${booth.body.id}/kiosk-code`, { method: "POST" })).status).toBe(403);
    expect((await K(`/events/${event.body.id}/photos`)).status).toBe(403);
    const launched = await K(`/booths/${booth.body.id}/kiosk/launch`, { method: "POST" });
    expect(launched.status).toBe(200);
    const kioskCookie = launched.setCookie!.split(";")[0];
    expect(kioskCookie).toMatch(/^pb_kiosk=/);
    expect((await call(`/kiosk/config?booth=${booth.body.code}`, { cookie: kioskCookie, ip: "10.0.20.4" })).status).toBe(200);

    // owner still does everything
    expect((await O(`/booths/${booth.body.id}/kiosk-code`, { method: "POST" })).status).toBe(200);
  });

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
