import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { startLocalServer } from "../src/local/server.js";
import { SimulatedCamera } from "../src/camera/simulated.js";
import { SimulatedPrinter } from "../src/printer/simulated.js";
import { PrintQueue } from "../src/printer/queue.js";
import { Store } from "../src/store.js";

const PORT = 47900 + Math.floor(Math.random() * 90);
const SITE = "https://pbooth.example.com";
const booth = { boothId: "b-1", boothCode: "PB-TEST", localSecret: randomBytes(32).toString("base64url") };
let server: Server;

// Raw HTTP so the test can set Host/Origin exactly as a browser or attacker would.
function req(method: string, path: string, headers: Record<string, string> = {}, body?: Buffer | string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port: PORT, method, path, headers: { host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on("error", reject);
    r.end(body);
  });
}
const json = (b: Buffer) => JSON.parse(b.toString("utf8"));
const ticket = (boothId = booth.boothId, secret = booth.localSecret, exp = Math.floor(Date.now() / 1000) + 300) => {
  const payload = Buffer.from(JSON.stringify({ boothId, exp, nonce: "n" })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
};

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "pbooth-local-"));
  const store = new Store(":memory:");
  const camera = new SimulatedCamera();
  await camera.connect();
  const printer = new SimulatedPrinter(dir);
  const queue = new PrintQueue(store, () => printer, dir);
  server = await startLocalServer({
    port: PORT, version: "test", simulated: true, photosDir: dir, allowedOrigins: () => [SITE], identity: () => booth,
    camera: () => camera, printer: () => printer, queue, getJob: (id) => store.job(id), queueSummary: () => store.summary(),
    printSettings: () => ({ enabled: true, printerName: null, paperSize: "4x6", orientation: "portrait" }),
  });
});
afterAll(() => server.close());

async function paired() {
  const r = await req("POST", "/pair", { origin: SITE, "content-type": "application/json" }, JSON.stringify({ ticket: ticket() }));
  expect(r.status).toBe(200);
  return json(r.body).token as string;
}

describe("agent local API security", () => {
  it("answers health checks from the pbooth site", async () => {
    const r = await req("GET", "/health", { origin: SITE });
    expect(r.status).toBe(200);
    expect(json(r.body).boothCode).toBe("PB-TEST");
    expect(r.headers["access-control-allow-origin"]).toBe(SITE);
  });

  it("refuses DNS-rebinding hosts", async () => {
    expect((await req("GET", "/health", { host: `evil.example:${PORT}` })).status).toBe(403);
  });

  it("refuses other websites", async () => {
    const r = await req("GET", "/health", { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers Chrome's private-network preflight for the pbooth site only", async () => {
    const ok = await req("OPTIONS", "/pair", { origin: SITE, "access-control-request-method": "POST", "access-control-request-private-network": "true" });
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-private-network"]).toBe("true");
    expect((await req("OPTIONS", "/pair", { origin: "https://evil.example" })).status).toBe(403);
  });

  it("needs a pairing ticket signed for this booth", async () => {
    expect((await req("GET", "/status", { origin: SITE })).status).toBe(401);
    for (const bad of [ticket("other-booth"), ticket(booth.boothId, randomBytes(32).toString("base64url")), ticket(booth.boothId, booth.localSecret, 1), "junk"]) {
      const r = await req("POST", "/pair", { origin: SITE, "content-type": "application/json" }, JSON.stringify({ ticket: bad }));
      expect(r.status).toBe(401);
    }
    const token = await paired();
    const s = await req("GET", "/status", { origin: SITE, authorization: `Bearer ${token}` });
    expect(s.status).toBe(200);
    expect(json(s.body).camera.compatibility).toBe("simulated");
    // tokens in the URL only work for the live-view image
    expect((await req("GET", `/status?t=${token}`, { origin: SITE })).status).toBe(401);
  });

  it("captures a photo as JPEG with its checksum", async () => {
    const token = await paired();
    const r = await req("POST", "/camera/capture", { origin: SITE, authorization: `Bearer ${token}` });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/jpeg");
    expect(r.headers["x-photo-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body[0]).toBe(0xff);
  });

  it("prints once per session id and validates input", async () => {
    const token = await paired();
    const auth = { origin: SITE, authorization: `Bearer ${token}`, "content-type": "image/jpeg" };
    const img = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#456" } }).jpeg().toBuffer();
    const id = randomUUID();
    const a = await req("POST", `/print?id=${id}&copies=2`, auth, img);
    const b = await req("POST", `/print?id=${id}&copies=2`, auth, img);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(json(b.body).job.id).toBe(id);
    expect((await req("POST", "/print?id=nope", auth, img)).status).toBe(400);
    expect((await req("POST", `/print?id=${randomUUID()}`, auth, Buffer.from("not an image"))).status).toBe(415);
    const status = await req("GET", `/print/${id}`, { origin: SITE, authorization: `Bearer ${token}` });
    expect(["submitted", "printing", "queued", "submitting"]).toContain(json(status.body).job.status);
  });
});
