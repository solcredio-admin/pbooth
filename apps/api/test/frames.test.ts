import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { base, call, login, newEvent } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;
const IP = "10.0.60.1";
const png = (w: number, h: number, alpha = true) => sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 30, b: 90, alpha: 0.5 } : "#c81e5a" } }).png().toBuffer();

describe.skipIf(!url)("event frames", () => {
  it("uploads a PNG per layout, sends it to the booth, serves it, and refuses the wrong file", async () => {
    const cookie = await login(IP);
    const O = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie, ip: IP, ...init });
    const ev = (await O("/events", { method: "POST", body: { ...newEvent, name: `Frames ${randomUUID().slice(0, 6)}`, config: { layout: "strip", shotsPerSession: 3 } } })).body;
    const put = async (path: string, body: Buffer) => {
      const r = await fetch(`${base}/events/${ev.id}/frames/${path}`, { method: "PUT", body, headers: { "content-type": "image/png", cookie, origin: "http://app.test", "x-forwarded-for": IP } });
      return { status: r.status, body: await r.json() };
    };
    expect((await put("strip/1", await png(600, 1800))).body.error.code).toBe("NO_SUCH_LAYOUT");
    expect((await put("strip/3", await png(1800, 1200))).body.error.code).toBe("WRONG_SHAPE");
    expect((await put("strip/3", await png(600, 1800, false))).body.error.code).toBe("NO_WINDOWS");
    expect((await put("strip/3", Buffer.from("not a png"))).status).toBe(422);
    const a = await put("strip/3", await png(300, 900)); // half size: scaled up to print size
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ layout: "strip", shots: 3, width: 600, height: 1800 });
    const b = (await put("strip/3", await png(600, 1800))).body; // replacing gives a new id
    expect(b.id).not.toBe(a.body.id);
    expect((await O(`/events/${ev.id}`)).body.frames).toEqual([b]);
    const file = await fetch(`${base}/frames/${b.id}`);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("cache-control")).toContain("immutable");
    expect((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).width).toBe(600);
    expect((await fetch(`${base}/frames/${a.body.id}`)).status).toBe(404);

    // the booth's config carries it, by layout and number of photos
    const booth = (await O("/booths", { method: "POST", body: { name: `Frames booth ${b.id.slice(0, 6)}` } })).body;
    await O(`/events/${ev.id}/booths`, { method: "POST", body: { boothId: booth.id } });
    await O(`/events/${ev.id}/activate`, { method: "POST" });
    const { code } = (await O(`/booths/${booth.id}/kiosk-code`, { method: "POST" })).body;
    const kiosk = (await call("/kiosk/pair", { method: "POST", ip: IP, body: { boothCode: booth.code, code } })).setCookie!.split(";")[0];
    expect((await call(`/kiosk/config?booth=${booth.code}`, { cookie: kiosk, ip: IP })).body.event.guest.template.frames).toEqual({ "strip-3": `/api/v1/frames/${b.id}` });

    expect((await O(`/events/${ev.id}/frames/strip/3`, { method: "DELETE" })).status).toBe(200);
    expect((await O(`/events/${ev.id}`)).body.frames).toEqual([]);
  }, 30_000);
});
