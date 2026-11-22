import { spawn } from "node:child_process";

export interface RunResult { code: number | null; stdout: string; stderr: string }

/**
 * Runs a program with arguments (never through a shell, so no quoting or injection problems)
 * and a timeout. Throws only if the program can't be started (e.g. not installed).
 */
export function run(cmd: string, args: string[], opts: { timeoutMs?: number; input?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = "", stderr = "";
    const t = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 30_000);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
    if (opts.input !== undefined) p.stdin.end(opts.input); else p.stdin.end();
  });
}

/** True when `cmd` can be started at all. */
export async function available(cmd: string, versionArg = "--version") {
  try { await run(cmd, [versionArg], { timeoutMs: 5000 }); return true; } catch { return false; }
}
