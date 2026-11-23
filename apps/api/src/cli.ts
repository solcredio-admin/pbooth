// Admin account management. There is exactly one admin, created here, never by default.
// The first account (an admin, who then adds everyone else in Settings → Users):
//   node dist/cli.js admin:create --username you                      (asks for the password)
//   echo "$PW" | node dist/cli.js admin:create --username you --password-stdin
//   (--email still works as the username, for older notes)
//   node dist/cli.js admin:reset-password [--username <name>] [--password-stdin]  (locked out? use this)
// Database backups (in the photo bucket, under backups/):
//   node dist/cli.js backup:list
//   node dist/cli.js backup:now
//   node dist/cli.js backup:restore --key backups/pbooth-....dump --yes  (or --file ./x.dump)
//     Replaces the whole database. A safety backup of the current data is saved first.
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { readFile } from "node:fs/promises";
import { hashPassword, passwordProblem } from "./auth/password.js";
import { usernameSchema } from "./users/users.service.js";
import { loadConfig } from "./config.js";
import { StorageService } from "./storage/storage.service.js";
import { BACKUP_PREFIX } from "./backups/backups.service.js";
import { dumpDatabase, restoreDatabase } from "./backups/pg.js";

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fromStdin = args.includes("--password-stdin");

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, "");
}

// Reads a line without echoing it to the terminal.
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let asked = false;
    out._writeToOutput = (s) => { if (!asked) { process.stdout.write(s); asked = true; } };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function newPassword() {
  if (fromStdin) return readStdin();
  if (!process.stdin.isTTY) throw new Error("No terminal: pass --password-stdin and pipe the password in");
  const a = await askHidden("New password: ");
  const b = await askHidden("Repeat password: ");
  if (a !== b) throw new Error("Passwords don't match");
  return a;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    if (cmd === "admin:create") {
      const name = usernameSchema.safeParse(flag("--username") ?? flag("--email") ?? "");
      if (!name.success) throw new Error(`Pass a valid --username (${name.error.issues[0]?.message})`);
      const username = name.data;
      if ((await db.admin.count()) > 0) throw new Error("An account already exists. Add more people in Settings → Users, or use admin:reset-password.");
      const pw = await newPassword();
      const problem = passwordProblem(pw);
      if (problem) throw new Error(problem);
      const admin = await db.admin.create({ data: { username, role: "OWNER", passwordHash: await hashPassword(pw) } });
      await db.auditLog.create({ data: { actor: "cli", action: "admin.create", entityType: "admin", entityId: admin.id } });
      console.log(`Super admin ${username} created.`);
    } else if (cmd === "admin:reset-password") {
      // a given user, or (locked out of everything) the oldest admin; also re-enables that account
      const who = flag("--username")?.trim().toLowerCase();
      const admin = who ? await db.admin.findUnique({ where: { username: who } }) : await db.admin.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });
      if (!admin) throw new Error(who ? `No user ${who}` : "No admin yet. Use admin:create first.");
      const pw = await newPassword();
      const problem = passwordProblem(pw);
      if (problem) throw new Error(problem);
      await db.$transaction([
        db.admin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(pw), disabled: false } }),
        db.adminSession.deleteMany({ where: { adminId: admin.id } }), // sign out everywhere
      ]);
      await db.auditLog.create({ data: { actor: "cli", action: "admin.reset-password", entityType: "admin", entityId: admin.id } });
      console.log(`Password for ${admin.username} reset; all sessions signed out.`);
    } else if (cmd?.startsWith("backup:")) {
      await backupCommand(db);
    } else {
      console.log("Commands: admin:create --username <name> [--password-stdin] | admin:reset-password [--username <name>] [--password-stdin] | backup:list | backup:now | backup:restore --key <key>|--file <path> --yes");
      process.exitCode = cmd ? 1 : 0;
    }
  } finally {
    await db.$disconnect();
  }
}

async function backupCommand(db: PrismaClient) {
  const cfg = loadConfig();
  const storage = new StorageService(cfg);
  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
  const save = async (name: string) => {
    if (!storage.enabled) throw new Error("Photo storage (S3_*) isn't configured; backups live in that bucket");
    const dump = await dumpDatabase(cfg.DATABASE_URL);
    const key = `${BACKUP_PREFIX}${name}-${stamp()}.dump`;
    await storage.put(key, dump, "application/octet-stream");
    return { key, size: dump.length };
  };
  if (cmd === "backup:list") {
    if (!storage.enabled) throw new Error("Photo storage (S3_*) isn't configured");
    for (const o of await storage.list(BACKUP_PREFIX)) console.log(`${o.at.toISOString()}  ${String(o.size).padStart(10)}  ${o.key}`);
  } else if (cmd === "backup:now") {
    const b = await save("pbooth");
    await db.auditLog.create({ data: { actor: "cli", action: "backup.create", entityType: "backup", entityId: b.key, metadata: { size: b.size } } });
    console.log(`Saved ${b.key} (${b.size} bytes).`);
  } else if (cmd === "backup:restore") {
    const key = flag("--key"), file = flag("--file");
    if (!key && !file) throw new Error("Pass --key <backup key> or --file <path>");
    if (!args.includes("--yes")) throw new Error("This replaces the whole database. Add --yes to confirm.");
    const dump = file ? await readFile(file) : await storage.get(key!);
    const safety = storage.enabled ? await save("pre-restore") : null;
    if (safety) console.log(`Safety backup of the current data: ${safety.key}`);
    await db.$disconnect(); // pg_restore drops and recreates every table
    await restoreDatabase(cfg.DATABASE_URL, dump);
    console.log(`Restored ${key ?? file}. Restart the app so it reconnects: docker compose restart app`);
  } else {
    throw new Error(`Unknown command ${cmd}`);
  }
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
