import { describe, expect, it } from "vitest";
import { base, call as rawCall, login as rawLogin, newEvent, type CallInit } from "./helpers.js";

const IP = "10.0.2.1";
const call = (path: string, init: CallInit = {}) => rawCall(path, { ip: IP, ...init });
const login = () => rawLogin(IP);
const device = { identifier: "test-machine-1", hostname: "booth-pc", os: "linux", agentVersion: "0.0.0-test" };

async function enrolledBooth(cookie: string, name = "Booth A") {
  const { body: booth } = await call("/booths", { method: "POST", body: { name }, cookie });
  const { body: code } = await call(`/booths/${booth.id}/enrollment-code`, { method: "POST", cookie });
  const enrolled = await call("/devices/enroll", { method: "POST", body: { code: code.code, device, simulated: true } });
  expect(enrolled.status).toBe(200);
  return { booth, token: enrolled.body.token as string, code: code.code as string };
}

describe.skipIf(!base)("booths and devices", () => {
  it("creates a booth with a code and default hardware settings", async () => {
    const cookie = await login();
    const r = await call("/booths", { method: "POST", body: { name: "Front Lobby" }, cookie });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^PB-[0-9A-Z]{4}$/);
    expect(r.body.status).toBe("UNREGISTERED");
    expect(r.body.camera.provider).toBe("webcam");
    expect(r.body.printer.paperSize).toBe("4x6");
  });

  it("enrolls a device once per code, then tracks heartbeats", async () => {
    const cookie = await login();
    const { booth, token, code } = await enrolledBooth(cookie);
    expect(token).toMatch(/^pbd_/);

    // the code is single use
    const again = await call("/devices/enroll", { method: "POST", body: { code, device } });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("INVALID_CODE");

    expect((await call(`/booths/${booth.id}`, { cookie })).body.status).toBe("READY");
    const hb = await call("/devices/heartbeat", { method: "POST", token, body: { pendingUploads: 2, camera: { status: "connected", name: "Simulated camera" } } });
    expect(hb.status).toBe(200);
    const after = (await call(`/booths/${booth.id}`, { cookie })).body;
    expect(after.status).toBe("ONLINE");
    expect(after.simulated).toBe(true);
    expect(after.device.telemetry.pendingUploads).toBe(2);
    expect(after.configApplied).toBe(false);

    // config sync: fetch, ack, and the admin sees it applied
    const cfg = await call("/devices/config", { token });
    expect(cfg.body.version).toBe(hb.body.configVersion);
    expect(cfg.body.booth.code).toBe(booth.code);
    await call("/devices/config/ack", { method: "POST", token, body: { version: cfg.body.version } });
    expect((await call(`/booths/${booth.id}`, { cookie })).body.configApplied).toBe(true);

    // changing the camera changes the version: pending until the booth applies it
    const changed = await call(`/booths/${booth.id}`, { method: "PATCH", cookie, body: { camera: { provider: "webcam", deviceName: null, resolution: "1080p", orientation: "portrait", mirrorPreview: true } } });
    expect(changed.body.configVersion).not.toBe(cfg.body.version);
    expect(changed.body.configApplied).toBe(false);
  });

  it("reports device errors as ERROR", async () => {
    const cookie = await login();
    const { booth, token } = await enrolledBooth(cookie, "Booth Err");
    await call("/devices/heartbeat", { method: "POST", token, body: { lastError: "Camera disconnected" } });
    expect((await call(`/booths/${booth.id}`, { cookie })).body.status).toBe("ERROR");
  });

  it("rejects unknown device tokens and missing tokens", async () => {
    expect((await call("/devices/config", { token: "pbd_" + "x".repeat(43) })).status).toBe(401);
    expect((await call("/devices/config", { origin: null })).status).toBe(401);
    expect((await call("/devices/enroll", { method: "POST", body: { code: "ZZZZ-ZZZZ", device } })).status).toBe(401);
  });

  it("serves a live event to its booths and blocks double-booking", async () => {
    const cookie = await login();
    const { booth, token } = await enrolledBooth(cookie, "Booth Live");
    await call("/devices/heartbeat", { method: "POST", token, body: {} });
    const { body: e1 } = await call("/events", { method: "POST", body: { ...newEvent, name: "Party One" }, cookie });
    const { body: e2 } = await call("/events", { method: "POST", body: { ...newEvent, name: "Party Two" }, cookie });

    expect((await call(`/events/${e1.id}/booths`, { method: "POST", body: { boothId: booth.id }, cookie })).status).toBe(200);
    expect((await call(`/events/${e2.id}/booths`, { method: "POST", body: { boothId: booth.id }, cookie })).status).toBe(200); // booked for both: fine while not live

    await call(`/events/${e1.id}/activate`, { method: "POST", cookie });
    const live = (await call(`/booths/${booth.id}`, { cookie })).body;
    expect(live.status).toBe("ACTIVE");
    expect(live.liveEvent.name).toBe("Party One");
    const cfg = (await call("/devices/config", { token })).body;
    expect(cfg.event.name).toBe("Party One");
    expect(cfg.event.guest.countdownSeconds).toBe(3);
    expect(cfg.event.guest.template).toEqual({ layout: "landscape", footerText: "Party One", showDate: true, logo: null, pattern: "none", frameStyle: "line", photoStyle: "rounded", fontStyle: "serif" });

    const clash = await call(`/events/${e2.id}/activate`, { method: "POST", cookie });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("BOOTH_BUSY");
    expect(clash.body.error.message).toContain("Booth Live");

    const listed = await call(`/events/${e1.id}/booths`, { cookie });
    expect(listed.body.items.map((b: { id: string }) => b.id)).toContain(booth.id);

    await call(`/events/${e1.id}/complete`, { method: "POST", cookie });
    expect((await call(`/events/${e2.id}/activate`, { method: "POST", cookie })).status).toBe(200); // free again

    expect((await call(`/events/${e2.id}/booths/${booth.id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await call("/devices/config", { token })).body.event).toBeNull();
  });

  it("revoking kills the device token immediately", async () => {
    const cookie = await login();
    const { booth, token } = await enrolledBooth(cookie, "Booth Revoke");
    expect((await call("/devices/config", { token })).status).toBe(200);
    const r = await call(`/booths/${booth.id}/revoke`, { method: "POST", cookie });
    expect(r.body.status).toBe("REVOKED");
    expect((await call("/devices/heartbeat", { method: "POST", token, body: {} })).status).toBe(401);
    expect((await call(`/events/00000000-0000-4000-8000-000000000000/booths`, { method: "POST", body: { boothId: booth.id }, cookie })).status).toBe(404);
  });

  it("keeps booth admin endpoints behind admin sign-in", async () => {
    expect((await call("/booths")).status).toBe(401);
    const { token } = await enrolledBooth(await login(), "Booth Token");
    // a device token is not an admin session
    expect((await call("/booths", { token })).status).toBe(401);
  });
});
