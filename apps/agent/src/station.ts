import { createHash } from "node:crypto";
import { CloudError, type Cloud, type StationJob, type StationSettings } from "./cloud.js";
import type { PrintQueue } from "./printer/queue.js";
import type { Store } from "./store.js";

const GIVE_UP = 3; // downloads that fail this often in a row: the print goes back in line

const STOPPED_MS = 60_000; // how long a stopped printer may hold a print that a backup could take

/**
 * This computer as a print station. Every tick asks the cloud what this station holds and brings the
 * local queue in line, so a lost answer, an outage or a crash at any point is just another tick.
 *
 * Nothing goes to the printer before the cloud has said "yes, print it" (the job turns PRINTING) for
 * exactly that attempt. Until then the cloud may give the job to another station; after it, only this
 * one prints, once, unless it can prove nothing was printed and hands the job back.
 * Two notes per job survive a crash: ask:<id> (the attempt we asked for) and remote:<id> (the attempt
 * we acted on, written before acting).
 */
export class Station {
  settings: StationSettings | null = null;
  private failures = new Map<string, number>();
  private stoppedAt = 0;

  constructor(
    private readonly store: Store, private readonly queue: PrintQueue, private readonly cloud: Pick<Cloud, "poll" | "report" | "download">,
    /** The printer as it is now: what's wrong with it, or null. */
    private readonly hardware: (s: StationSettings) => Promise<{ error: string | null; printers: { name: string; isDefault?: boolean }[] }>,
    private readonly about: object = {},
  ) {}

  /** Returns true when something moved: worth asking again at once, so a busy line has no gaps. */
  async tick(): Promise<boolean> {
    let hw = this.settings ? await this.hardware(this.settings) : { error: null, printers: [] };
    const first = !this.settings;
    const r = await this.cloud.poll({ ...this.about, ready: !first && !hw.error, error: hw.error?.slice(0, 500) ?? null, printers: hw.printers.slice(0, 40) });
    this.settings = r.station;
    if (first) hw = await this.hardware(r.station); // before printing anything it already held
    this.stoppedAt = hw.error ? this.stoppedAt || Date.now() : 0;
    let moved = first;
    for (const j of r.jobs) if (await this.handle(j, r.station, hw.error)) moved = true;
    // Ours no more (staff moved it): stop what can still be stopped. Mid-hand-off is left for the next tick.
    for (const l of this.store.jobsWith("queued", "submitted", "printing")) if (this.store.get(`remote:${l.id}`) && !r.jobs.some((j) => j.id === l.id)) await this.queue.cancel(l.id);
    return moved;
  }

  private async handle(j: StationJob, s: StationSettings, problem: string | null): Promise<boolean> {
    const local = this.store.job(j.id);
    const acted = Number(this.store.get(`remote:${j.id}`) ?? 0), asked = Number(this.store.get(`ask:${j.id}`) ?? 0);
    const ended = local?.status === "failed" || local?.status === "cancelled";

    if (!local || (ended && j.attempt > acted)) {
      // It was told to print before, but there's no trace of that here: it may have come out.
      if (j.status === "PRINTING" && asked !== j.attempt) return this.report(j, "FAILED", "This computer has no record of this print. Check the printer before printing again.");
      if (problem) return this.report(j, "FAILED", problem, true);
      let image: Buffer | null = null;
      if (!local) {
        try {
          image = await this.cloud.download(j.url);
          if (createHash("sha256").update(image).digest("hex") !== j.sha256) throw new Error("the photo arrived damaged");
        } catch (e) {
          const n = (this.failures.get(j.id) ?? 0) + 1;
          this.failures.set(j.id, n);
          if (n < GIVE_UP) throw e;
          this.failures.delete(j.id);
          return this.report(j, "FAILED", `Couldn't download the photo: ${(e as Error).message}`, true);
        }
        this.failures.delete(j.id);
      }
      this.store.set(`ask:${j.id}`, String(j.attempt));
      if (j.status === "CLAIMED" && !(await this.report(j, "PRINTING", null))) return true; // given to another station meanwhile
      this.store.set(`remote:${j.id}`, String(j.attempt));
      if (image) {
        try { await this.queue.submit(j.id, image, { printer: s.printerName, copies: j.copies, paper: j.strip ? "2x6" : s.paperSize, orientation: s.orientation }); }
        catch (e) { return this.report(j, "FAILED", `Couldn't prepare the print: ${(e as Error).message}`); }
      } else {
        this.store.updateJob(j.id, { printer: s.printerName });
        await this.queue.retry(j.id);
      }
      return true;
    }
    if (local.status === "completed") return this.report(j, "DONE", null);
    if (ended) return this.report(j, "FAILED", local.error ?? "Cancelled at the station", this.queue.isSafe(j.id));
    if (j.backup && local.status === "submitted" && this.stoppedAt && Date.now() - this.stoppedAt > STOPPED_MS) { await this.queue.abandon(j.id, problem ?? "Printer stopped"); return true; }
    return false;
  }

  /** False when the job isn't ours any more: the next poll says what became of it. */
  private async report(j: StationJob, status: "PRINTING" | "DONE" | "FAILED", error: string | null, safe = false) {
    try { await this.cloud.report(j.id, { attempt: j.attempt, status, error: error?.slice(0, 500) ?? null, safe }); return true; }
    catch (e) { if (!(e instanceof CloudError && e.status === 409)) throw e; return false; }
  }
}
