// pg_dump / pg_restore, shared by the API (daily + "back up now"), the CLI (restore) and the tests.
// The connection goes through PG* environment variables, so the password never appears in the
// process list or in error messages.
import { spawn } from "node:child_process";

function pgEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const u = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
  };
}

function run(cmd: string, args: string[], databaseUrl: string, input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: pgEnv(databaseUrl), stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    p.stdout.on("data", (b: Buffer) => out.push(b));
    p.stderr.on("data", (b: Buffer) => err.push(b));
    p.on("error", (e) => reject(new Error(`${cmd} isn't available: ${e.message}`)));
    p.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} failed (${code}): ${Buffer.concat(err).toString().trim().slice(0, 500)}`));
    });
    p.stdin.end(input);
  });
}

/**
 * The whole database as one pg_dump custom-format file.
 * shortcut: held in memory, fine for pbooth's size (metadata only, photos live in the bucket);
 * stream to a multipart upload if the database ever grows past a few hundred MB.
 */
export const dumpDatabase = (databaseUrl: string) =>
  run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges"], databaseUrl);

/** Replaces the database's contents with a dump, in one transaction (all or nothing). */
export const restoreDatabase = (databaseUrl: string, dump: Buffer) =>
  run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--single-transaction", "--exit-on-error", "--dbname", new URL(databaseUrl).pathname.slice(1)], databaseUrl, dump);
