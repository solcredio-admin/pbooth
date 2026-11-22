import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTicket } from "../src/devices/ticket.js";
import { base, call as rawCall, login as rawLogin, newEvent, type CallInit } from "./helpers.js";

const IP = "10.0.4.1";
const call = (path: string, init: CallInit = {}) => rawCall(path, { ip: IP, ...init });
const login = () => rawLogin(IP);

async function pairedKiosk(admin: string, name: string) {
  const { body: booth } = await call("/booths", { method: "POST", body: { name }, cookie: admin });
  const { body: code } = await call(`/booths/${booth.id}/kiosk-code`, { method: "POST", cookie: admin });
  const r = await call("/kiosk/pair", { method: "POST", body: { boothCode: booth.code, code: code.code } });
  expect(r.status).toBe(200);
  return { booth, kiosk: r.setCookie!.split(";")[0], cookieHeader: r.setCookie!, code: code.code as string };
}

describe.skipIf(!base)("kiosk and sessions", () => {
  it("pairs only with the right booth, using an HttpOnly cookie", async () => {
    const admin = await login();
    const { body: a } = await call("/booths", { method: "POST", body: { name: "Kiosk A" }, cookie: admin });
    const { body: b } = await call("/booths", { method: "POST", body: { name: "Kiosk B" }, cookie: admin });
    const { body: code } = await call(`/booths/${a.id}/kiosk-code`, { method: "POST", cookie: admin });

    // A's code can't pair booth B
    expect((await call("/kiosk/pair", { method: "POST", body: { boothCode: b.code, code: code.code } })).status).toBe(401);
    const ok = await call("/kiosk/pair", { method: "POST", body: { boothCode: a.code, code: code.code } });
    expect(ok.setCookie).toMatch(/pb_kiosk=.+HttpOnly/i);
    expect(ok.setCookie).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(ok.body)).not.toContain(ok.setCookie!.split(";")[0].split("=")[1]); // token only in the cookie
    // single use
    expect((await call("/kiosk/pair", { method: "POST", body: { boothCode: a.code, code: code.code } })).status).toBe(401);

    const kiosk = ok.setCookie!.split(";")[0];
    expect((await call(`/kiosk/config?booth=${a.code}`, { cookie: kiosk })).status).toBe(200);
    const wrong = await call(`/kiosk/config?booth=${b.code}`, { cookie: kiosk });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe("WRONG_BOOTH");
  });

  it("a kiosk alone makes a webcam booth show online, with its cameras", async () => {
    const admin = await login();
    const { booth, kiosk } = await pairedKiosk(admin, "Webcam Booth");
    await call("/kiosk/heartbeat", { method: "POST", cookie: kiosk, body: { camera: { status: "connected", name: "FaceTime HD", resolution: "1920x1080" }, cameras: [{ id: "a1", name: "FaceTime HD" }] } });
    const b = (await call(`/booths/${booth.id}`, { cookie: admin })).body;
    expect(b.status).toBe("ONLINE");
    expect(b.kiosk.telemetry.camera.resolution).toBe("1920x1080");
    expect(b.kiosk.telemetry.cameras[0].name).toBe("FaceTime HD");

    await call("/kiosk/heartbeat", { method: "POST", cookie: kiosk, body: { lastError: "Camera permission denied", camera: { status: "permission-denied" } } });
    expect((await call(`/booths/${booth.id}`, { cookie: admin })).body.status).toBe("ERROR");
  });

  it("records sessions idempotently, only for a live event", async () => {
    const admin = await login();
    const { booth, kiosk } = await pairedKiosk(admin, "Session Booth");
    const id = randomUUID();
    const none = await call("/sessions", { method: "POST", cookie: kiosk, body: { id } });
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe("NO_LIVE_EVENT");

    const { body: e } = await call("/events", { method: "POST", body: { ...newEvent, name: "Session Party" }, cookie: admin });
    await call(`/events/${e.id}/booths`, { method: "POST", body: { boothId: booth.id }, cookie: admin });
    await call(`/events/${e.id}/activate`, { method: "POST", cookie: admin });

    const started = await call("/sessions", { method: "POST", cookie: kiosk, body: { id, startedAt: new Date().toISOString() } });
    expect(started.status).toBe(201);
    expect(started.body.eventId).toBe(e.id);
    expect((await call("/sessions", { method: "POST", cookie: kiosk, body: { id } })).body.id).toBe(id); // retry: same session

    const done = await call(`/sessions/${id}/status`, { method: "PATCH", cookie: kiosk, body: { status: "COMPLETED", photoCount: 3, retakeCount: 1 } });
    expect(done.body.status).toBe("COMPLETED");
    // a late retry doesn't change it
    const again = await call(`/sessions/${id}/status`, { method: "PATCH", cookie: kiosk, body: { status: "ABANDONED", photoCount: 0 } });
    expect(again.body.status).toBe("COMPLETED");
    expect(again.body.photoCount).toBe(3);

    await call(`/sessions/${id}/status`, { method: "PATCH", cookie: kiosk, body: { status: "ABANDONED" } });
    const abandoned = randomUUID();
    await call("/sessions", { method: "POST", cookie: kiosk, body: { id: abandoned } });
    await call(`/sessions/${abandoned}/status`, { method: "PATCH", cookie: kiosk, body: { status: "ABANDONED", photoCount: 1 } });

    const listed = await call(`/events/${e.id}/booths`, { cookie: admin });
    expect(listed.body.sessions.total).toEqual({ sessions: 2, completed: 1, photos: 3 });
    expect(listed.body.sessions.byBooth[booth.id].completed).toBe(1);

    expect((await call(`/sessions/${id}`, { cookie: admin })).body.booth.code).toBe(booth.code);
    expect((await call(`/sessions/${id}`, { cookie: kiosk })).status).toBe(401); // kiosks can't read admin data
  });

  it("issues agent pairing tickets signed with the agent's secret", async () => {
    const admin = await login();
    const { booth, kiosk } = await pairedKiosk(admin, "Agent Ticket Booth");
    expect((await call("/kiosk/agent-ticket", { method: "POST", cookie: kiosk })).body.error.code).toBe("NO_AGENT");

    const { body: code } = await call(`/booths/${booth.id}/enrollment-code`, { method: "POST", cookie: admin });
    const enrolled = await call("/devices/enroll", { method: "POST", body: { code: code.code, device: { identifier: "agent-1" } } });
    expect(enrolled.body.localSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const t = await call("/kiosk/agent-ticket", { method: "POST", cookie: kiosk });
    expect(t.status).toBe(200);
    expect(verifyTicket(t.body.ticket, booth.id, enrolled.body.localSecret)).toBe(true);
    expect(JSON.stringify(t.body)).not.toContain(enrolled.body.localSecret); // the secret itself never reaches the browser
    expect((await call("/kiosk/agent-ticket", { method: "POST" })).status).toBe(401);
  });

  it("accepts sessions shot offline after the event was completed (late sync)", async () => {
    const admin = await login();
    const { booth, kiosk } = await pairedKiosk(admin, "Late Sync Booth");
    const { body: e } = await call("/events", { method: "POST", body: { ...newEvent, name: "Late Party" }, cookie: admin });
    const { body: other } = await call("/events", { method: "POST", body: { ...newEvent, name: "Not Ours" }, cookie: admin });
    await call(`/events/${e.id}/booths`, { method: "POST", body: { boothId: booth.id }, cookie: admin });
    await call(`/events/${e.id}/activate`, { method: "POST", cookie: admin });
    await call(`/events/${e.id}/complete`, { method: "POST", cookie: admin }); // ended while the booth was offline

    const id = randomUUID();
    const late = await call("/sessions", { method: "POST", cookie: kiosk, body: { id, eventId: e.id, startedAt: new Date(Date.now() - 3600_000).toISOString() } });
    expect(late.status).toBe(201);
    expect(late.body.eventId).toBe(e.id);
    // not for an event this booth wasn't booked for, and not without saying which event
    expect((await call("/sessions", { method: "POST", cookie: kiosk, body: { id: randomUUID(), eventId: other.id } })).status).toBe(409);
    expect((await call("/sessions", { method: "POST", cookie: kiosk, body: { id: randomUUID() } })).status).toBe(409);
  });

  it("never lets a kiosk cookie into admin endpoints", async () => {
    const { kiosk } = await pairedKiosk(await login(), "Nosy Kiosk");
    expect((await call("/booths", { cookie: kiosk })).status).toBe(401);
    expect((await call("/events", { cookie: kiosk })).status).toBe(401);
    expect((await call("/auth/me", { cookie: kiosk })).status).toBe(401);
  });

  it("unpairing or revoking signs the kiosk out", async () => {
    const admin = await login();
    const one = await pairedKiosk(admin, "Unpair Booth");
    await call(`/booths/${one.booth.id}/kiosk/unpair`, { method: "POST", cookie: admin });
    expect((await call(`/kiosk/config?booth=${one.booth.code}`, { cookie: one.kiosk })).status).toBe(401);

    const two = await pairedKiosk(admin, "Revoke Booth");
    await call(`/booths/${two.booth.id}/revoke`, { method: "POST", cookie: admin });
    const r = await call(`/kiosk/config?booth=${two.booth.code}`, { cookie: two.kiosk });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("KIOSK_UNPAIRED");
    expect((await call(`/booths/${two.booth.id}/kiosk-code`, { method: "POST", cookie: admin })).status).toBe(409);
  });
});
