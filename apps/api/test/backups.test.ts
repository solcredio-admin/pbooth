import { execFileSync } from "node:child_process";
import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import { call, login, newEvent } from "./helpers.js";
import { restoreDatabase } from "../src/backups/pg.js";

const url = process.env.TEST_DATABASE_URL;
const hasPgTools = (() => { try { execFileSync("pg_dump", ["--version"]); return true; } catch { return false; } })();

describe.skipIf(!url || !inject("s3") || !hasPgTools)("database backups (real pg_dump, bucket and pg_restore)", () => {
  it("backs up to the bucket, and the backup restores into an empty database", { timeout: 60_000 }, async () => {
    const admin = await login("10.0.9.1");
    const marker = `Backup marker ${Date.now()}`;
    await call("/events", { method: "POST", body: { ...newEvent, name: marker }, cookie: admin, ip: "10.0.9.1" });

    const made = await call("/backups", { method: "POST", cookie: admin, ip: "10.0.9.1" });
    expect(made.status).toBe(200);
    expect(made.body.key).toMatch(/^backups\/pbooth-.*\.dump$/);
    expect(made.body.size).toBeGreaterThan(1000);

    const listed = await call("/backups", { cookie: admin, ip: "10.0.9.1" });
    const item = listed.body.items.find((o: { key: string }) => o.key === made.body.key);
    expect(item).toBeTruthy();
    const dump = Buffer.from(await (await fetch(item.url)).arrayBuffer()); // the Settings download link

    // restore test: into a fresh database, then look for the data
    const target = new URL(url!);
    target.pathname = "/restore_check";
    const admin_db = new pg.Client({ connectionString: url });
    await admin_db.connect();
    await admin_db.query("DROP DATABASE IF EXISTS restore_check");
    await admin_db.query("CREATE DATABASE restore_check");
    await admin_db.end();
    await restoreDatabase(target.toString(), dump);
    const check = new pg.Client({ connectionString: target.toString() });
    await check.connect();
    const events = await check.query(`SELECT count(*)::int AS n FROM "Event" WHERE name = $1`, [marker]);
    const admins = await check.query(`SELECT username FROM "Admin" ORDER BY username`);
    const migrations = await check.query(`SELECT count(*)::int AS n FROM "_prisma_migrations"`);
    await check.end();
    expect(events.rows[0].n).toBe(1);
    // the same accounts as the live database had (other test files add users before this one)
    const live = new pg.Client({ connectionString: url });
    await live.connect();
    const liveAdmins = await live.query(`SELECT username FROM "Admin" ORDER BY username`);
    await live.end();
    expect(admins.rows).toEqual(liveAdmins.rows);
    expect(migrations.rows[0].n).toBeGreaterThan(5); // schema history came along, so migrate deploy keeps working
  });

  it("is admin-only", async () => {
    expect((await call("/backups", { method: "POST" })).status).toBe(401);
    expect((await call("/backups")).status).toBe(401);
  });
});
