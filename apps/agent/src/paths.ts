import { mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// Where the agent keeps its database, photos and print files.
//   Linux:   /var/lib/pbooth-agent when run as a service, else ~/.local/share/pbooth-agent
//   Windows: %ProgramData%\pbooth-agent
//   Override with PBOOTH_AGENT_DIR.
export function stateDir() {
  const dir = process.env.PBOOTH_AGENT_DIR
    ?? (platform() === "win32" ? join(process.env.ProgramData ?? "C:\\ProgramData", "pbooth-agent")
      : process.getuid?.() === 0 ? "/var/lib/pbooth-agent"
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "pbooth-agent"));
  for (const sub of ["", "photos", "prints"]) mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 }); // owner only: holds the device token
  return dir;
}
