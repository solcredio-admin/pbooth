import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { call, login } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;
const IP = "10.0.70.1";
const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000) => {
  for (const end = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 250))) { const v = await get(); if (ok(v)) return v; if (Date.now() > end) throw new Error(`timed out: ${JSON.stringify(v).slice(0, 300)}`); }
};

describe.skipIf(!url)("alerts for managed events", () => {
  it("a booth going silent at a managed event alerts while the event is on, not before it", async () => {
    const cookie = await login(IP);
    const O = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie, ip: IP, ...init });
    const today = new Date().toISOString().slice(0, 10);
    const live = async (name: string, date: string) => {
      const ev = (await O("/events", { method: "POST", body: { name, date, startTime: "00:00", endTime: "23:59", timeZone: "UTC" } })).body;
      const booth = (await O("/booths", { method: "POST", body: { name: `Booth ${name}` } })).body;
      await O(`/events/${ev.id}/booths`, { method: "POST", body: { boothId: booth.id } });
      expect((await O(`/events/${ev.id}/activate`, { method: "POST" })).status).toBe(200);
      const { code } = (await O(`/booths/${booth.id}/kiosk-code`, { method: "POST" })).body;
      const kiosk = (await call("/kiosk/pair", { method: "POST", ip: IP, body: { boothCode: booth.code, code } })).setCookie!.split(";")[0];
      await call("/kiosk/heartbeat", { method: "POST", cookie: kiosk, ip: IP, body: {} }); // seen once, then silent
      return booth;
    };
    const on = await live(`Gala ${randomUUID().slice(0, 6)}`, today);
    const later = await live(`Later ${randomUUID().slice(0, 6)}`, "2027-06-01");
    const recent = async () => (await O("/alerts")).body.recent as { kind: string; text: string }[];
    await until(recent, (x) => x.some((a) => a.kind === "OFFLINE" && a.text.includes(on.name)));
    expect((await recent()).some((a) => a.text.includes(later.name))).toBe(false); // hasn't started: no alert
  }, 40_000);
});
