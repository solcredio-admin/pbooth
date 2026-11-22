import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Store, PrintJob } from "../store.js";
import type { PrinterProvider } from "./types.js";
import { preparePrint, type Paper } from "./image.js";

const MAX_ATTEMPTS = 3;
const POLL_MS = 3000;
const GIVE_UP_MS = 10 * 60_000;

/**
 * Print jobs with no accidental duplicates:
 *  - the job id comes from the kiosk (its session id), so sending the same print twice is a no-op;
 *  - jobs live in SQLite, so a restart resumes them;
 *  - a job that was mid-hand-off when the agent stopped is NOT resent automatically (it may already
 *    be printing); it's marked failed with a note so a person checks the printer, then retries.
 */
export class PrintQueue {
  private timer?: NodeJS.Timeout;
  constructor(private readonly store: Store, private readonly printer: () => PrinterProvider | null, private readonly dir: string, private readonly onChange: () => void = () => undefined) {}

  start() {
    for (const j of this.store.jobsWith("submitting")) {
      this.store.updateJob(j.id, { status: "failed", error: "The agent restarted while sending this job. Check the printer before retrying, to avoid a double print." });
    }
    for (const j of this.store.jobsWith("queued")) void this.send(j.id);
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); }

  async submit(id: string, image: Buffer, opts: { printer: string | null; copies: number; paper: Paper; orientation: "portrait" | "landscape" }): Promise<{ job: PrintJob; created: boolean }> {
    const existing = this.store.job(id);
    if (existing) return { job: existing, created: false };
    const prepared = await preparePrint(image, opts.paper, opts.orientation);
    const file = join(this.dir, `${id}.jpg`);
    await writeFile(file, prepared.buffer);
    const created = this.store.insertJob({ id, printer: opts.printer, copies: opts.copies, paper: opts.paper, orientation: prepared.landscape ? "landscape" : "portrait", file });
    if (created) { this.onChange(); void this.send(id); }
    return { job: this.store.job(id)!, created };
  }

  async retry(id: string) {
    const j = this.store.job(id);
    if (!j) return null;
    if (j.status === "failed" || j.status === "cancelled") {
      this.store.updateJob(id, { status: "queued", attempts: 0, error: null, provider_job_id: null });
      void this.send(id);
    }
    return this.store.job(id)!;
  }

  async cancel(id: string) {
    const j = this.store.job(id);
    if (!j) return null;
    if (j.provider_job_id && ["submitted", "printing"].includes(j.status)) await this.printer()?.cancelPrint(j.provider_job_id, j.printer).catch(() => undefined);
    if (!["completed", "cancelled"].includes(j.status)) this.store.updateJob(id, { status: "cancelled" });
    this.onChange();
    return this.store.job(id)!;
  }

  private async send(id: string) {
    const j = this.store.job(id);
    const p = this.printer();
    if (!j || j.status !== "queued") return;
    if (!p) { this.store.updateJob(id, { status: "failed", error: "No printer is set up on this booth" }); this.onChange(); return; }
    this.store.updateJob(id, { status: "submitting", attempts: j.attempts + 1 });
    try {
      const { providerJobId } = await p.submitPrint({ file: j.file, printer: j.printer, copies: j.copies, ...dims(j), jobName: `pbooth-${j.id}` });
      this.store.updateJob(id, { status: "submitted", provider_job_id: providerJobId, error: null });
    } catch (e) {
      const attempts = j.attempts + 1;
      const error = (e as Error).message;
      if (attempts < MAX_ATTEMPTS) {
        this.store.updateJob(id, { status: "queued", error });
        setTimeout(() => void this.send(id), 4000 * attempts).unref();
      } else {
        this.store.updateJob(id, { status: "failed", error });
      }
    }
    this.onChange();
  }

  private async poll() {
    const p = this.printer();
    if (!p) return;
    for (const j of this.store.jobsWith("submitted", "printing")) {
      try {
        const s = await p.getJobStatus(j.provider_job_id!, j.printer);
        if (s.state === "completed") this.store.updateJob(j.id, { status: "completed", completed_at: new Date().toISOString(), error: null });
        else if (s.state === "printing" && j.status !== "printing") this.store.updateJob(j.id, { status: "printing" });
        else if (s.state === "failed") this.store.updateJob(j.id, { status: "failed", error: s.message ?? "The printer reported an error" });
        else if (s.message && s.message !== j.error) this.store.updateJob(j.id, { error: s.message });
        if (s.state !== "completed" && Date.now() - Date.parse(j.created_at) > GIVE_UP_MS) {
          this.store.updateJob(j.id, { status: "failed", error: s.message ?? "Not printed after 10 minutes" });
        }
        if (s.state !== "unknown") this.onChange();
      } catch { /* printer tools hiccup: try again next round */ }
    }
  }
}

function dims(j: PrintJob) {
  const [w, h] = j.paper === "5x7" ? [5, 7] : [4, 6];
  const landscape = j.orientation === "landscape";
  return { widthIn: landscape ? h : w, heightIn: landscape ? w : h, landscape };
}
