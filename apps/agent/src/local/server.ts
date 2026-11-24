import { randomBytes, createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { CameraProvider } from "../camera/types.js";
import type { PrinterProvider } from "../printer/types.js";
import type { PrintQueue } from "../printer/queue.js";
import type { PrintJob } from "../store.js";
import type { Paper } from "../printer/image.js";
import { corsHeaders, hostAllowed, originAllowed } from "./security.js";
import { verifyTicket } from "./ticket.js";

export interface LocalDeps {
  port: number;
  allowedOrigins: () => string[];
  identity: () => { boothId: string; boothCode: string; localSecret: string } | null;
  camera: () => CameraProvider | null;
  printer: () => PrinterProvider | null;
  queue: PrintQueue;
  getJob: (id: string) => PrintJob | undefined;
  queueSummary: () => { queued: number; failed: number; completedToday: number };
  printSettings: () => { enabled: boolean; printerName: string | null; paperSize: Paper; orientation: "portrait" | "landscape" };
  photosDir: string;
  version: string;
  simulated: boolean;
}

const TOKEN_MS = 12 * 3600_000;
const MAX_BODY = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The agent's local API. Bound to 127.0.0.1 only: nothing on the network can reach it. */
export function startLocalServer(d: LocalDeps): Promise<Server> {
  const tokens = new Map<string, number>(); // local session token → expiry (memory only; a restart just means re-pairing)
  const pairAttempts: number[] = [];

  const valid = (t: string | null | undefined) => {
    if (!t) return false;
    const exp = tokens.get(t);
    if (!exp || exp < Date.now()) { tokens.delete(t ?? ""); return false; }
    return true;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${d.port}`);
    // Only an allowed origin is ever named in CORS headers; anything else gets none.
    const origin = req.headers.origin && d.allowedOrigins().includes(req.headers.origin) ? req.headers.origin : undefined;
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(origin, false), ...headers });
      res.end(JSON.stringify(body));
    };

    if (!hostAllowed(req.headers.host, d.port)) return send(403, { error: { code: "BAD_HOST", message: "Use 127.0.0.1 or localhost" } });
    if (!originAllowed(req.headers.origin, d.allowedOrigins())) return send(403, { error: { code: "BAD_ORIGIN", message: "This site may not use the booth agent" } });
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(origin, req.headers["access-control-request-private-network"] === "true"));
      return res.end();
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        const id = d.identity();
        return send(200, { ok: true, agentVersion: d.version, boothCode: id?.boothCode ?? null, enrolled: !!id, simulated: d.simulated });
      }

      if (req.method === "POST" && url.pathname === "/pair") {
        const now = Date.now();
        while (pairAttempts.length && pairAttempts[0] < now - 60_000) pairAttempts.shift();
        if (pairAttempts.push(now) > 20) return send(429, { error: { code: "RATE_LIMITED", message: "Too many pairing attempts" } });
        const id = d.identity();
        if (!id) return send(409, { error: { code: "NOT_ENROLLED", message: "This agent isn't enrolled yet" } });
        const body = JSON.parse((await readBody(req, 10_000)).toString("utf8") || "{}");
        if (!verifyTicket(body.ticket, id.boothId, id.localSecret)) return send(401, { error: { code: "BAD_TICKET", message: "Pairing ticket is invalid or expired" } });
        const token = randomBytes(32).toString("base64url");
        tokens.set(token, now + TOKEN_MS);
        return send(200, { token, expiresAt: new Date(now + TOKEN_MS).toISOString(), boothCode: id.boothCode });
      }

      // Everything below needs a paired kiosk. <img> can't send headers, so live view takes ?t=.
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      const token = bearer ?? (url.pathname === "/camera/live" ? url.searchParams.get("t") : null);
      if (!valid(token)) return send(401, { error: { code: "UNPAIRED", message: "Pair the kiosk with the agent first" } });

      if (req.method === "GET" && url.pathname === "/status") {
        const cam = d.camera();
        const printer = d.printer();
        const ps = d.printSettings();
        const p = printer && ps.enabled ? await printer.getStatus(ps.printerName).catch(() => null) : null;
        return send(200, {
          camera: cam ? { ...cam.getStatus(), capabilities: cam.getCapabilities() } : null,
          printer: ps.enabled ? (p ? { name: p.name, status: p.status, message: p.message } : { status: "missing", message: ps.printerName ? `${ps.printerName} not found` : "No default printer" }) : null,
          printJobs: d.queueSummary(),
        });
      }

      if (req.method === "GET" && url.pathname === "/camera/live") return liveView(d.camera(), req, res, origin);

      if (req.method === "POST" && url.pathname === "/camera/capture") {
        const cam = d.camera();
        if (!cam || cam.getStatus().status !== "connected") return send(409, { error: { code: "NO_CAMERA", message: cam?.getStatus().error ?? "No camera connected" } });
        const shot = await cam.capture(d.photosDir);
        const jpeg = await cam.downloadImage(shot);
        const sha256 = createHash("sha256").update(jpeg).digest("hex");
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "x-photo-sha256": sha256, ...corsHeaders(origin, false), "Access-Control-Expose-Headers": "x-photo-sha256" });
        return res.end(jpeg);
      }

      const printMatch = /^\/print\/([0-9a-f-]{36})(?:\/(retry|cancel))?$/i.exec(url.pathname);
      if (req.method === "POST" && url.pathname === "/print") {
        const id = url.searchParams.get("id") ?? "";
        if (!UUID.test(id)) return send(400, { error: { code: "BAD_ID", message: "id must be a UUID (the kiosk session id)" } });
        const ps = d.printSettings();
        if (!ps.enabled) return send(409, { error: { code: "PRINTING_OFF", message: "Printing is turned off for this booth" } });
        const copies = Math.min(5, Math.max(1, Number(url.searchParams.get("copies")) || 1));
        const image = await readBody(req, MAX_BODY);
        if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) return send(415, { error: { code: "NOT_JPEG", message: "Send the image as JPEG" } });
        const { job, created } = await d.queue.submit(id, image, { printer: ps.printerName, copies, paper: ps.paperSize, orientation: ps.orientation });
        return send(created ? 201 : 200, { job: publicJob(job) });
      }
      if (printMatch && req.method === "GET" && !printMatch[2]) {
        const job = d.getJob(printMatch[1]);
        return job ? send(200, { job: publicJob(job) }) : send(404, { error: { code: "NOT_FOUND", message: "No such print job" } });
      }
      if (printMatch && req.method === "POST" && printMatch[2]) {
        const job = printMatch[2] === "retry" ? await d.queue.retry(printMatch[1]) : await d.queue.cancel(printMatch[1]);
        return job ? send(200, { job: publicJob(job) }) : send(404, { error: { code: "NOT_FOUND", message: "No such print job" } });
      }
      return send(404, { error: { code: "NOT_FOUND", message: "Unknown endpoint" } });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return send(status, { error: { code: status === 413 ? "TOO_LARGE" : "AGENT_ERROR", message: (e as Error).message } });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(d.port, "127.0.0.1", () => resolve(server)); // loopback only
  });
}

function publicJob(j: PrintJob) {
  return { id: j.id, status: j.status, error: j.error, copies: j.copies, paper: j.paper, attempts: j.attempts, createdAt: j.created_at, completedAt: j.completed_at };
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("Too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// One camera feed shared by every viewer (normally just the kiosk). Stops when nobody watches.
const viewers = new Set<ServerResponse>();
let stopFeed: (() => void) | null = null;
const FEED_RETRY_MS = 1000;

async function liveView(cam: CameraProvider | null, req: IncomingMessage, res: ServerResponse, origin: string | undefined) {
  if (!cam || cam.getStatus().status !== "connected" || !cam.getCapabilities().liveView) {
    res.writeHead(409, { "content-type": "application/json", ...corsHeaders(origin, false) });
    return res.end(JSON.stringify({ error: { code: "NO_CAMERA", message: cam?.getStatus().error ?? "No camera connected" } }));
  }
  res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-store", connection: "close", ...corsHeaders(origin, false) });
  viewers.add(res);
  req.on("close", () => {
    viewers.delete(res);
    if (!viewers.size && stopFeed) { stopFeed(); stopFeed = null; }
  });
  if (!stopFeed) await startFeed(cam);
}

// One camera feed shared by every viewer. If it drops (camera hiccup, cable), the kiosk's stream
// stays open and the feed restarts every few seconds while anyone is watching.
async function startFeed(cam: CameraProvider) {
  stopFeed = await cam.liveView(
    (jpeg) => { for (const v of viewers) v.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), v.write(jpeg), v.write("\r\n"); },
    () => {
      stopFeed = null;
      setTimeout(() => { if (viewers.size && !stopFeed) startFeed(cam).catch(() => undefined); }, FEED_RETRY_MS);
    },
  );
}
