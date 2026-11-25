import { run } from "../exec.js";
import { NotPrinted } from "./types.js";
import type { JobState, PrinterInfo, PrinterProvider, Submit } from "./types.js";

// Linux/macOS printing through CUPS's command-line tools (lp, lpstat, cancel).
// Paper is requested by size in points (w288h432 = 4x6 in); dye-sub drivers map that to their
// media. Ink/paper levels are NOT reported: lpstat doesn't expose them reliably.

export function parsePrinters(lpstatP: string, lpstatD: string): PrinterInfo[] {
  const def = /system default destination: (\S+)/.exec(lpstatD)?.[1];
  const out: PrinterInfo[] = [];
  for (const line of lpstatP.split("\n")) {
    const m = /^printer (\S+) (is idle|now printing|disabled)/.exec(line);
    if (m) {
      out.push({ name: m[1], isDefault: m[1] === def, status: m[2] === "is idle" ? "idle" : m[2] === "now printing" ? "printing" : "stopped" });
    } else if (/^\s+\S/.test(line) && out.length) {
      // CUPS puts the reason a printer stopped (e.g. "Paper out") on the following, indented line.
      const last = out[out.length - 1];
      last.message = [last.message, line.trim()].filter(Boolean).join(" ");
    }
  }
  return out;
}

/** "request id is PDF-12 (1 file(s))" → "PDF-12" */
export const parseRequestId = (out: string) => /request id is (\S+)/.exec(out)?.[1] ?? null;

/** Job ids listed by "lpstat -o" style output. */
export const listedJobs = (out: string) => new Set(out.split("\n").map((l) => l.split(/\s+/)[0]).filter(Boolean));

/**
 * Every driver names borderless its own way: a page size ("4x6.Borderless"), a switch ("StpFullBleed",
 * "Borderless"), or just zero margins (driverless printers). `lpoptions -l` says which this one has.
 */
export function borderless(lpoptionsL: string, media: string, widthIn: number, heightIn: number) {
  const [w, h] = [Math.min(widthIn, heightIn), Math.max(widthIn, heightIn)];
  const size = new RegExp(`^(w${w * 72}h${h * 72}|(photo|na_index-|na_|custom_)?${w}x${h}(in|photo)?)(?!\\d)`, "i");
  const out: string[] = [];
  let page = media;
  for (const line of lpoptionsL.split("\n")) {
    const m = /^([^/:\s]+)[^:]*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const choices = m[2].split(/\s+/).map((c) => c.replace(/^\*/, ""));
    if (m[1] === "PageSize" || m[1] === "media") page = choices.find((c) => size.test(c) && /borderless|full.?bleed|nmgn|[._]bl$/i.test(c)) ?? page;
    else if (/borderless|bleed/i.test(m[1])) {
      const on = choices.find((c) => /^(true|on|yes|1|borderless)$/i.test(c));
      if (on) out.push("-o", `${m[1]}=${on}`);
    }
  }
  const zero = ["top", "right", "bottom", "left"].flatMap((s) => ["-o", `media-${s}-margin=0`, "-o", `page-${s}=0`]);
  return ["-o", `media=${page}`, ...out, ...zero, "-o", "fit-to-page", "-o", "print-scaling=fill"];
}

export class CupsPrinter implements PrinterProvider {
  readonly kind = "cups" as const;

  async discover() {
    const [p, d] = await Promise.all([run("lpstat", ["-p"], { timeoutMs: 10_000 }), run("lpstat", ["-d"], { timeoutMs: 10_000 })]);
    return parsePrinters(p.stdout, d.stdout);
  }

  async getStatus(printer: string | null) {
    const all = await this.discover();
    return all.find((x) => (printer ? x.name === printer : x.isDefault)) ?? null;
  }

  async submitPrint(j: Submit) {
    // drivers list the sheet upright only (w288h432); orientation-requested turns the picture
    const media = `w${Math.round(Math.min(j.widthIn, j.heightIn) * 72)}h${Math.round(Math.max(j.widthIn, j.heightIn) * 72)}`;
    const opts = await run("lpoptions", [...(j.printer ? ["-p", j.printer] : []), "-l"], { timeoutMs: 10_000 }).catch(() => null); // can't ask: zero margins still apply
    const args = [
      ...(j.printer ? ["-d", j.printer] : []),
      "-n", String(j.copies), "-t", j.jobName,
      ...borderless(opts?.stdout ?? "", media, j.widthIn, j.heightIn), "-o", `orientation-requested=${j.landscape ? 4 : 3}`,
      j.file,
    ];
    const r = await run("lp", args, { timeoutMs: 30_000 }).catch((e: Error) => { throw new NotPrinted(e.message); }); // lp couldn't even start
    const id = parseRequestId(r.stdout);
    if (r.code) throw new NotPrinted(r.stderr.trim() || "lp refused the job");
    if (r.code !== 0 || !id) throw new Error(r.stderr.trim() || "lp didn't answer");
    return { providerJobId: id };
  }

  async getJobStatus(id: string, printer: string | null): Promise<JobState> {
    const dest = printer ? [printer] : [];
    const pending = await run("lpstat", ["-W", "not-completed", "-o", ...dest], { timeoutMs: 10_000 });
    if (listedJobs(pending.stdout).has(id)) {
      const p = await this.getStatus(printer);
      if (p?.status === "stopped") return { state: "queued", message: `Printer stopped${p.message ? `: ${p.message}` : ""}` };
      return { state: p?.status === "printing" ? "printing" : "queued" };
    }
    const done = await run("lpstat", ["-W", "completed", "-o", ...dest], { timeoutMs: 10_000 });
    return listedJobs(done.stdout).has(id) ? { state: "completed" } : { state: "unknown" };
  }

  async cancelPrint(id: string) {
    await run("cancel", [id], { timeoutMs: 10_000 });
  }
}
