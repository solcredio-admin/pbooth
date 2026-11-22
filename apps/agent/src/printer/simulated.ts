import { copyFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { JobState, PrinterProvider, Submit } from "./types.js";

// SIMULATED printer (agent --simulate): accepts jobs, "prints" them by copying the print-ready
// file into <state>/simulated-prints, and takes a few seconds like a real dye-sub would.
export class SimulatedPrinter implements PrinterProvider {
  readonly kind = "simulated" as const;
  private jobs = new Map<string, number>();
  constructor(private readonly outDir: string) {}
  async discover() { return [{ name: "Simulated printer", isDefault: true, status: "idle" as const }]; }
  async getStatus() { return { name: "Simulated printer", isDefault: true, status: "idle" as const }; }
  async submitPrint(j: Submit) {
    const id = `sim-${this.jobs.size + 1}`;
    await copyFile(j.file, join(this.outDir, `${j.jobName}-${basename(j.file)}`));
    this.jobs.set(id, Date.now());
    return { providerJobId: id };
  }
  async getJobStatus(id: string): Promise<JobState> {
    const at = this.jobs.get(id);
    if (at === undefined) return { state: "unknown" };
    const t = Date.now() - at;
    return { state: t < 1500 ? "queued" : t < 4000 ? "printing" : "completed" };
  }
  async cancelPrint(id: string) { this.jobs.delete(id); }
}
