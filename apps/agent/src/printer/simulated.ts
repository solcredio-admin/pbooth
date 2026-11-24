import { appendFile, copyFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { JobState, PrinterProvider, Submit } from "./types.js";

// SIMULATED printer (agent --simulate): accepts jobs, "prints" them by copying the print-ready
// file into <state>/simulated-prints, and takes a few seconds like a real dye-sub would.
export class SimulatedPrinter implements PrinterProvider {
  readonly kind = "simulated" as const;
  private n = 0;
  private cancelled = new Set<string>();
  constructor(private readonly outDir: string) {}
  async discover() { return [{ name: "Simulated printer", isDefault: true, status: "idle" as const }]; }
  async getStatus() { return { name: "Simulated printer", isDefault: true, status: "idle" as const }; }
  async submitPrint(j: Submit) {
    const id = `sim-${Date.now()}-${++this.n}`; // carries its own start time, so a restarted agent still follows it
    await copyFile(j.file, join(this.outDir, `${j.jobName}-${basename(j.file)}`));
    await appendFile(join(this.outDir, "prints.log"), `${j.jobName}\n`); // one line per print that came out
    return { providerJobId: id };
  }
  async getJobStatus(id: string): Promise<JobState> {
    const t = Date.now() - Number(/^sim-(\d+)/.exec(id)?.[1]);
    return { state: Number.isNaN(t) || this.cancelled.has(id) ? "unknown" : t < 1500 ? "queued" : t < 4000 ? "printing" : "completed" };
  }
  async cancelPrint(id: string) { this.cancelled.add(id); }
}
