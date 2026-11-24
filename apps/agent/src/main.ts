#!/usr/bin/env node
// pbooth hardware agent.
//   pbooth-agent enroll --server https://pbooth.example.com --code XXXX-XXXX [--simulate]
//   pbooth-agent run [--port 47800]
//   pbooth-agent doctor          checks gPhoto2, CUPS/Windows printing, cameras and printers
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { platform } from "node:os";
import { stateDir } from "./paths.js";
import { Store } from "./store.js";
import { AGENT_VERSION, DEFAULT_PORT, enroll, identity, runAgent } from "./agent.js";
import { GPhoto2Camera } from "./camera/gphoto2.js";
import { compatibilityFor } from "./camera/registry.js";
import { CupsPrinter } from "./printer/cups.js";
import { WindowsPrinter } from "./printer/windows.js";
import { available } from "./exec.js";

// Booth networks (café and venue Wi-Fi) often advertise IPv6 that doesn't actually work: try IPv4
// first and don't wait long on a dead address, or every request to the server times out.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamilyAttemptTimeout(500);

const [cmd, ...args] = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  const dir = stateDir();
  const store = new Store(dir);
  if (cmd === "enroll") {
    const server = flag("server"), code = flag("code");
    if (!server || !code) throw new Error("Usage: pbooth-agent enroll --server https://<host> --code XXXX-XXXX [--simulate]");
    const booth = await enroll(store, server, code, args.includes("--simulate"));
    console.log(`Enrolled as ${booth.name} (${booth.code}). Start it with: pbooth-agent run`);
  } else if (cmd === "run") {
    await runAgent(store, dir, Number(flag("port")) || DEFAULT_PORT);
  } else if (cmd === "doctor" || cmd === "status") {
    const id = identity(store);
    console.log(`pbooth agent ${AGENT_VERSION} · ${platform()} · state in ${dir}`);
    console.log(id ? `Enrolled: booth ${id.boothCode} on ${id.server}${id.simulated ? " (SIMULATED)" : ""}` : "Not enrolled");
    if (platform() === "win32") {
      console.log("DSLR: not supported on Windows in v1 (USB webcams work in the kiosk).");
      try { console.log("Printers:", (await new WindowsPrinter().discover()).map((p) => `${p.name}${p.isDefault ? " (default)" : ""}`).join(", ") || "none"); }
      catch (e) { console.log(`Printers: ${(e as Error).message}`); }
    } else {
      const g = await available("gphoto2");
      console.log(`gPhoto2: ${g ? "installed" : "missing (sudo apt install gphoto2)"}`);
      if (g) for (const c of await new GPhoto2Camera().discover()) console.log(`  camera: ${c.name} at ${c.id} — compatibility: ${compatibilityFor(c.name, platform() === "darwin" ? "darwin" : "linux").tested}`);
      const l = await available("lpstat", "-r");
      console.log(`CUPS: ${l ? "installed" : "missing (sudo apt install cups)"}`);
      if (l) for (const p of await new CupsPrinter().discover().catch(() => [])) console.log(`  printer: ${p.name}${p.isDefault ? " (default)" : ""} — ${p.status}${p.message ? `: ${p.message}` : ""}`);
    }
  } else {
    console.log("Commands: enroll | run | doctor   (see apps/agent/README.md)");
    process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => { console.error(`Error: ${(e as Error).message}`); process.exit(1); });
