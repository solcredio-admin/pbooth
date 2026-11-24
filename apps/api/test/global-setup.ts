// Integration tests run the real built server (dist/) against a real, throwaway Postgres.
// Set TEST_DATABASE_URL to enable them; without it only the unit tests run.
// The database is wiped first — never point this at a database you care about.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import pg from "pg";
import type { TestProject } from "vitest/node";

import { ADMIN } from "./fixtures.js";
const PORT = 4100;
let server: ChildProcess | undefined;
let mock: Server | undefined;

// A fake PayMongo: payment intents with a QR Ph method attached, plus a test-only "pay" switch.
function fakePaymongo() {
  const intents = new Map<string, { amount: number; currency: string; status: string }>();
  let n = 0, methods = 0;
  const refunds = new Map<string, { status: string; key: string; amount: number; payment: string }>();
  const telegram: { chat: string; text: string }[] = [];
  let refuse = 0; // the next refund answers with this status
  const intent = (id: string) => { const i = intents.get(id)!; return { data: { id, attributes: { ...i, client_key: `${id}_client`, payments: i.status === "succeeded" ? [{ id: `pay_${id}`, attributes: { status: "paid" } }] : [], next_action: i.status === "awaiting_next_action" ? { type: "consume_qr", code: { image_url: "iVBORw0KGgo=" } } : null } } }; };
  return createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const send = (status: number, json: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
    // a fake Telegram on the same server
    const tg = /^\/bot\d+:[\w-]+\/(\w+)$/.exec(req.url ?? "");
    if (tg?.[1] === "sendMessage") { if (body.chat_id === "666") return send(403, { ok: false, description: "Forbidden: bot was blocked by the user" }); telegram.push({ chat: body.chat_id, text: body.text }); return send(200, { ok: true, result: {} }); }
    if (tg?.[1] === "getMe") return send(200, { ok: true, result: { username: "pbooth_test_bot" } });
    if (tg?.[1] === "getUpdates") return send(200, { ok: true, result: [{ message: { chat: { id: 4242, first_name: "Owner", type: "private" } } }, { message: { chat: { id: -100777, title: "Café staff", type: "group" } } }] });
    if (req.url === "/test/telegram") return send(200, telegram);
    if (req.headers.authorization !== `Basic ${Buffer.from("sk_test_mock:").toString("base64")}`) return send(401, { errors: [{ detail: "bad key" }] });
    const u = req.url ?? ""; let m: RegExpMatchArray | null;
    if (req.method === "POST" && u === "/v1/payment_intents") { const id = `pi_${++n}`; intents.set(id, { amount: body.data.attributes.amount, currency: body.data.attributes.currency, status: "awaiting_payment_method" }); return send(200, intent(id)); }
    if (req.method === "POST" && u === "/v1/payment_methods") return send(200, { data: { id: `pm_${++methods}`, attributes: { type: body.data.attributes.type } } });
    if (req.method === "POST" && (m = u.match(/^\/v1\/payment_intents\/(pi_\d+)\/attach$/)) && intents.has(m[1])) { intents.get(m[1])!.status = "awaiting_next_action"; return send(200, intent(m[1])); }
    if (req.method === "GET" && (m = u.match(/^\/v1\/payment_intents\/(pi_\d+)$/)) && intents.has(m[1])) return send(200, intent(m[1]));
    if (req.method === "POST" && (m = u.match(/^\/test\/pay\/(pi_\d+)$/)) && intents.has(m[1])) { const i = intents.get(m[1])!; i.status = "succeeded"; if (body.amount) i.amount = body.amount; return send(200, {}); }
    if (req.method === "POST" && u === "/v1/refunds") {
      if (refuse) { const s = refuse; refuse = 0; return send(s, { errors: [{ detail: "insufficient balance" }] }); }
      const a = body.data.attributes, key = String(req.headers["idempotency-key"]);
      const again = [...refunds].find(([, r]) => r.key === key);
      const id = again?.[0] ?? `ref_${refunds.size + 1}`;
      if (!again) refunds.set(id, { status: "processing", key, amount: a.amount, payment: a.payment_id });
      return send(200, { data: { id, attributes: { status: refunds.get(id)!.status, transfer_link: "https://pm.example/claim/" + id } } });
    }
    if (req.method === "GET" && (m = u.match(/^\/v1\/refunds\/(ref_\d+)$/)) && refunds.has(m[1])) return send(200, { data: { id: m[1], attributes: { status: refunds.get(m[1])!.status, transfer_link: null } } });
    if (u === "/test/refunds") return send(200, [...refunds].map(([id, r]) => ({ id, ...r })));
    if (req.method === "POST" && (m = u.match(/^\/test\/refund\/(ref_\d+)\/(\w+)$/))) { refunds.get(m[1])!.status = m[2]; return send(200, {}); }
    if (req.method === "POST" && (m = u.match(/^\/test\/refuse\/(\d+)$/))) { refuse = Number(m[1]); return send(200, {}); }
    send(404, { errors: [{ detail: "not found" }] });
  });
}

export default async function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  // Optional S3-compatible store for the photo tests (SeaweedFS in CI-style runs).
  const s3 = process.env.TEST_S3_ENDPOINT
    ? { S3_ENDPOINT: process.env.TEST_S3_ENDPOINT, S3_BUCKET: "pbooth-test", S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test" }
    : {};
  if (process.env.TEST_S3_ENDPOINT) {
    const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");
    await new S3Client({ endpoint: process.env.TEST_S3_ENDPOINT, region: "auto", forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test" } })
      .send(new CreateBucketCommand({ Bucket: "pbooth-test" })).catch(() => undefined);
  }
  mock = fakePaymongo();
  await new Promise<void>((ok) => mock!.listen(PORT + 1, "127.0.0.1", ok));
  const paymongo = `http://127.0.0.1:${PORT + 1}`;
  const env = { ...process.env, ...s3, PAYMONGO_SECRET_KEY: "sk_test_mock", PAYMONGO_API_BASE: `${paymongo}/v1`, PAYMONGO_QR_SECONDS: "60", TELEGRAM_BOT_TOKEN: `123456:${"x".repeat(35)}`, TELEGRAM_API_BASE: paymongo, ALERT_SWEEP_SECONDS: "1", ALERT_OFFLINE_SECONDS: "4", ALERT_PROBLEM_SECONDS: "0", REFUND_FLAG_MINUTES: "0.1", PRINT_RELEASE_SECONDS: "3", PRINT_WAIT_MINUTES: "0.15", DATABASE_URL: url, APP_ORIGIN: "http://app.test", API_PORT: String(PORT), NODE_ENV: "test", TRUST_PROXY_HOPS: "1", ALLOW_SIMULATED_BOOTHS: "true", BOOTH_OFFLINE_AFTER_SECONDS: "30" };

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await db.end();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
  execFileSync("node", ["dist/cli.js", "admin:create", "--username", ADMIN.username, "--password-stdin"], { env, input: ADMIN.password, stdio: ["pipe", "inherit", "inherit"] });

  server = spawn("node", ["dist/main.js"], { env, stdio: "inherit" });
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  project.provide("apiBase", base);
  project.provide("s3", !!process.env.TEST_S3_ENDPOINT);
  project.provide("paymongo", paymongo);
  return async () => { server?.kill(); mock?.close(); };
}

declare module "vitest" {
  export interface ProvidedContext { apiBase: string; s3: boolean; paymongo: string }
}
