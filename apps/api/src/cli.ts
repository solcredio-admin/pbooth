// Admin account management. There is exactly one admin, created here, never by default.
//   node dist/cli.js admin:create --email you@example.com              (asks for the password)
//   echo "$PW" | node dist/cli.js admin:create --email you@example.com --password-stdin
//   node dist/cli.js admin:reset-password [--password-stdin]           (locked out? use this)
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { hashPassword, passwordProblem } from "./auth/password.js";

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
      const email = flag("--email")?.trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Pass a valid --email");
      if ((await db.admin.count()) > 0) throw new Error("An admin already exists. Use admin:reset-password instead.");
      const pw = await newPassword();
      const problem = passwordProblem(pw);
      if (problem) throw new Error(problem);
      const admin = await db.admin.create({ data: { email, passwordHash: await hashPassword(pw) } });
      await db.auditLog.create({ data: { actor: "cli", action: "admin.create", entityType: "admin", entityId: admin.id } });
      console.log(`Admin ${email} created.`);
    } else if (cmd === "admin:reset-password") {
      const admin = await db.admin.findFirst();
      if (!admin) throw new Error("No admin yet. Use admin:create first.");
      const pw = await newPassword();
      const problem = passwordProblem(pw);
      if (problem) throw new Error(problem);
      await db.$transaction([
        db.admin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(pw) } }),
        db.adminSession.deleteMany({ where: { adminId: admin.id } }), // sign out everywhere
      ]);
      await db.auditLog.create({ data: { actor: "cli", action: "admin.reset-password", entityType: "admin", entityId: admin.id } });
      console.log(`Password for ${admin.email} reset; all sessions signed out.`);
    } else {
      console.log("Commands: admin:create --email <email> [--password-stdin] | admin:reset-password [--password-stdin]");
      process.exitCode = cmd ? 1 : 0;
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
