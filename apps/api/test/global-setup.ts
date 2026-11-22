// Integration tests run the real built server (dist/) against a real, throwaway Postgres.
// Set TEST_DATABASE_URL to enable them; without it only the unit tests run.
// The database is wiped first — never point this at a database you care about.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import pg from "pg";
import type { TestProject } from "vitest/node";

import { ADMIN } from "./fixtures.js";
const PORT = 4100;
let server: ChildProcess | undefined;

export default async function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const env = { ...process.env, DATABASE_URL: url, APP_ORIGIN: "http://app.test", API_PORT: String(PORT), NODE_ENV: "test", TRUST_PROXY_HOPS: "1", ALLOW_SIMULATED_BOOTHS: "true", BOOTH_OFFLINE_AFTER_SECONDS: "30" };

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await db.end();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
  execFileSync("node", ["dist/cli.js", "admin:create", "--email", ADMIN.email, "--password-stdin"], { env, input: ADMIN.password, stdio: ["pipe", "inherit", "inherit"] });

  server = spawn("node", ["dist/main.js"], { env, stdio: "inherit" });
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  project.provide("apiBase", base);
  return async () => { server?.kill(); };
}

declare module "vitest" {
  export interface ProvidedContext { apiBase: string }
}
