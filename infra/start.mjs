// Container entrypoint: apply database migrations, then run the API and the web app.
// If either process dies, stop the other and exit, so Docker's restart policy brings
// the whole container back cleanly instead of leaving half an app running.
import { spawn, spawnSync } from "node:child_process";

const log = (m) => console.log(`[start] ${m}`);

if (!process.env.DATABASE_URL) {
  log("DATABASE_URL is not set; not starting");
  process.exit(1);
}
log("applying database migrations");
const migrate = spawnSync("node", ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: "/app/api", stdio: "inherit" });
if (migrate.status !== 0) {
  log("migrations failed; not starting (is the database up and DATABASE_URL right?)");
  process.exit(1);
}

const children = [
  spawn("node", ["dist/main.js"], { cwd: "/app/api", stdio: "inherit" }),
  spawn("node", ["server.js"], { cwd: "/app/web/apps/web", stdio: "inherit" }),
];
const names = ["api", "web"];
let exitCode = null; // set once: 0 for a requested shutdown, 1 if a process died on its own

const stop = (code) => {
  if (exitCode !== null) return;
  exitCode = code;
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 8000).unref(); // don't hang on a stuck child
};

children.forEach((c, i) => c.on("exit", (code, signal) => {
  log(`${names[i]} exited (${signal ?? code})`);
  stop(1);
  if (children.every((x) => x.exitCode !== null || x.signalCode !== null)) process.exit(exitCode);
}));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { log(`got ${sig}, shutting down`); stop(0); });
