import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, inject, it } from "vitest";
import { base, call as rawCall, login as rawLogin, newEvent, type CallInit } from "./helpers.js";

const IP = "10.0.5.1";
const call = (path: string, init: CallInit = {}) => rawCall(path, { ip: IP, ...init });
const login = () => rawLogin(IP);
const s3 = inject("s3");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const jpeg = (w = 1200, h = 1800, color = "#1b1730") => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();

/** A live event with a paired kiosk and one started session (with its QR gallery token). */
async function liveSession(name: string, config: Record<string, unknown> = { saveOriginals: true }) {
  const admin = await login();
  const { body: booth } = await call("/booths", { method: "POST", body: { name }, cookie: admin });
  const { body: code } = await call(`/booths/${booth.id}/kiosk-code`, { method: "POST", cookie: admin });
  const paired = await call("/kiosk/pair", { method: "POST", body: { boothCode: booth.code, code: code.code } });
  const kiosk = paired.setCookie!.split(";")[0];
  const { body: event } = await call("/events", { method: "POST", body: { ...newEvent, name: `${name} Event`, config }, cookie: admin });
  await call(`/events/${event.id}/booths`, { method: "POST", body: { boothId: booth.id }, cookie: admin });
  await call(`/events/${event.id}/activate`, { method: "POST", cookie: admin });
  const sessionId = randomUUID();
  const galleryToken = randomBytes(32).toString("base64url");
  expect((await call("/sessions", { method: "POST", cookie: kiosk, body: { id: sessionId, galleryToken } })).status).toBe(201);
  return { admin, kiosk, booth, event, sessionId, galleryToken };
}

async function upload(kiosk: string, sessionId: string, file: Buffer, kind: "DESIGN" | "ORIGINAL" = "DESIGN", index = 0) {
  const photoId = randomUUID();
  const a = await call("/photos/upload-authorize", { method: "POST", cookie: kiosk, body: { photoId, sessionId, kind, index, sha256: sha(file), size: file.length, contentType: "image/jpeg" } });
  expect(a.status).toBe(200);
  const put = await fetch(a.body.url, { method: "PUT", body: file, headers: a.body.headers });
  expect(put.status).toBe(200);
  return { photoId, authorize: a.body };
}

async function waitFor(admin: string, photoId: string, status: string) {
  for (let i = 0; i < 40; i++) {
    const p = await call(`/photos/${photoId}`, { cookie: admin });
    if (p.body?.status === status) return p.body;
    if (p.body?.status === "FAILED" && status !== "FAILED") throw new Error(p.body.error);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`photo never reached ${status}`);
}

describe.skipIf(!base || !s3)("photos, processing and galleries (real S3-compatible store)", () => {
  it("uploads, verifies, processes and serves a design through the QR gallery", async () => {
    const { admin, kiosk, sessionId, galleryToken } = await liveSession("Photo Booth");
    const file = await jpeg();
    const { photoId } = await upload(kiosk, sessionId, file);
    expect((await call("/photos/upload-complete", { method: "POST", cookie: kiosk, body: { photoId } })).body.status).toBe("UPLOADED");
    const done = await waitFor(admin, photoId, "PROCESSED");
    expect([done.width, done.height]).toEqual([1200, 1800]);
    expect(done.thumbKey).toMatch(/-thumb\.jpg$/);

    const meta = await call(`/galleries/${galleryToken}`);
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ scope: "SESSION", ready: 1, pending: 0, retentionDays: 30 });
    const photos = await call(`/galleries/${galleryToken}/photos`);
    expect(photos.body.items).toHaveLength(1);
    const downloaded = Buffer.from(await (await fetch(photos.body.items[0].downloadUrl)).arrayBuffer());
    expect(sha(downloaded)).toBe(sha(file)); // byte-for-byte the original
    const thumb = await sharp(Buffer.from(await (await fetch(photos.body.items[0].thumbUrl)).arrayBuffer())).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(480);
  });

  it("is idempotent and refuses a different file under the same id", async () => {
    const { kiosk, sessionId } = await liveSession("Idem Booth");
    const file = await jpeg(600, 400);
    const { photoId } = await upload(kiosk, sessionId, file);
    await call("/photos/upload-complete", { method: "POST", cookie: kiosk, body: { photoId } });
    const again = await call("/photos/upload-authorize", { method: "POST", cookie: kiosk, body: { photoId, sessionId, kind: "DESIGN", index: 0, sha256: sha(file), size: file.length, contentType: "image/jpeg" } });
    expect(again.body.alreadyUploaded).toBe(true);
    const other = await jpeg(600, 400, "#ff0000");
    const clash = await call("/photos/upload-authorize", { method: "POST", cookie: kiosk, body: { photoId, sessionId, kind: "DESIGN", index: 0, sha256: sha(other), size: other.length, contentType: "image/jpeg" } });
    expect(clash.status).toBe(409);
  });

  it("designs-only events refuse individual shots but take the design", async () => {
    const { kiosk, sessionId } = await liveSession("Designs Only", { saveOriginals: false });
    const file = await jpeg(300, 300);
    const body = (kind: string, index: number) => ({ photoId: randomUUID(), sessionId, kind, index, sha256: sha(file), size: file.length, contentType: "image/jpeg" });
    const shot = await call("/photos/upload-authorize", { method: "POST", cookie: kiosk, body: body("ORIGINAL", 1) });
    expect(shot.status).toBe(409);
    expect(shot.body.error.code).toBe("ORIGINALS_OFF");
    expect((await call("/photos/upload-authorize", { method: "POST", cookie: kiosk, body: body("DESIGN", 0) })).status).toBe(200);
  });

  it("won't confirm a photo that never arrived", async () => {
    const { kiosk, sessionId } = await liveSession("Early Booth");
    const file = await jpeg(300, 300);
    const photoId = randomUUID();
    await call("/photos/upload-authorize", { method: "POST", cookie: kiosk, body: { photoId, sessionId, kind: "ORIGINAL", index: 1, sha256: sha(file), size: file.length, contentType: "image/jpeg" } });
    const r = await call("/photos/upload-complete", { method: "POST", cookie: kiosk, body: { photoId } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("NOT_UPLOADED");
  });

  it("reads the bytes: a PNG dressed up as a JPEG is rejected", async () => {
    const { admin, kiosk, sessionId } = await liveSession("Png Booth");
    const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#0f0" } }).png().toBuffer();
    const { photoId } = await upload(kiosk, sessionId, png);
    await call("/photos/upload-complete", { method: "POST", cookie: kiosk, body: { photoId } });
    const failed = await waitFor(admin, photoId, "FAILED");
    expect(failed.error).toMatch(/Expected a JPEG/);
  });

  it("only the session's own booth may upload", async () => {
    const one = await liveSession("Booth One Up");
    const two = await liveSession("Booth Two Up");
    const file = await jpeg(300, 300);
    const body = { photoId: randomUUID(), sessionId: one.sessionId, kind: "DESIGN", index: 0, sha256: sha(file), size: file.length, contentType: "image/jpeg" };
    expect((await call("/photos/upload-authorize", { method: "POST", cookie: two.kiosk, body })).status).toBe(403);
    expect((await call("/photos/upload-authorize", { method: "POST", body })).status).toBe(401);
    expect((await call("/photos/upload-authorize", { method: "POST", cookie: one.admin, body })).status).toBe(401); // admins aren't booths
  });

  it("closes galleries that are unknown, disabled or rotated", async () => {
    const { admin, kiosk, event, sessionId, galleryToken } = await liveSession("Gallery Booth");
    const { photoId } = await upload(kiosk, sessionId, await jpeg(400, 600));
    await call("/photos/upload-complete", { method: "POST", cookie: kiosk, body: { photoId } });
    await waitFor(admin, photoId, "PROCESSED");

    expect((await call(`/galleries/${randomBytes(32).toString("base64url")}`)).status).toBe(404);
    const { body: g1 } = await call(`/events/${event.id}/gallery`, { method: "POST", cookie: admin });
    expect((await call(`/galleries/${g1.token}/photos`)).body.items).toHaveLength(1); // event gallery: every design
    const { body: g2 } = await call(`/events/${event.id}/gallery/rotate`, { method: "POST", cookie: admin });
    expect(g2.token).not.toBe(g1.token);
    expect((await call(`/galleries/${g1.token}`)).status).toBe(404);
    expect((await call(`/galleries/${g2.token}`)).status).toBe(200);

    await call(`/events/${event.id}`, { method: "PATCH", body: { config: { galleryEnabled: false } }, cookie: admin });
    expect((await call(`/galleries/${galleryToken}`)).status).toBe(404);
  });

  it("exports a ZIP, then deletes everything on request", async () => {
    const { admin, kiosk, event, sessionId, galleryToken } = await liveSession("Export Booth");
    const { photoId } = await upload(kiosk, sessionId, await jpeg(400, 600));
    await call("/photos/upload-complete", { method: "POST", cookie: kiosk, body: { photoId } });
    await waitFor(admin, photoId, "PROCESSED");

    const zip = await fetch(`${base}/events/${event.id}/export?kind=design`, { headers: { cookie: admin, "x-forwarded-for": IP } });
    expect(zip.headers.get("content-type")).toBe("application/zip");
    const bytes = Buffer.from(await zip.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");

    const listed = await call(`/events/${event.id}/photos`, { cookie: admin });
    expect(listed.body.sessions[0].photos[0].thumbUrl).toMatch(/^http/);
    expect((await call(`/events/${event.id}/photos`, { method: "DELETE", cookie: admin })).body.deleted).toBe(1);
    expect((await call(`/photos/${photoId}`, { cookie: admin })).status).toBe(404);
    expect((await call(`/galleries/${galleryToken}/photos`)).body.items).toHaveLength(0);
  });

  it("checks the storage setup end to end", async () => {
    const r = await call("/storage/check", { method: "POST", cookie: await login() });
    const step = (n: string) => r.body.steps.find((s: { name: string }) => s.name === n);
    expect(step("write + read").ok).toBe(true);
    expect(step("signed upload").ok).toBe(true);
    expect(step("checksum reported").ok).toBe(true);
  });
});
