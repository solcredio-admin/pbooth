import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CloudError, type StationJob } from "./cloud.js";
import { PrintQueue } from "./printer/queue.js";
import { NotPrinted, type JobState, type PrinterProvider } from "./printer/types.js";
import { Station } from "./station.js";
import { Store } from "./store.js";

const dir = mkdtempSync(join(tmpdir(), "pbooth-st-"));
const image = await sharp({ create: { width: 180, height: 120, channels: 3, background: "#345" } }).jpeg().toBuffer();
const sha256 = createHash("sha256").update(image).digest("hex");
const settle = () => new Promise((r) => setTimeout(r, 15));

/** The cloud's side of one job, as stations.service.ts does it. */
function world() {
  const id = crypto.randomUUID();
  const job = { id, attempt: 1, status: "CLAIMED" as string, mine: true, backup: false, requeues: 0, error: null as string | null };
  let prints = 0;
  const cloud = {
    ready: [] as boolean[],
    async poll(b: unknown) {
      cloud.ready.push((b as { ready: boolean }).ready);
      const held = job.mine && (job.status === "CLAIMED" || job.status === "PRINTING");
      return { station: { id: "s", name: "S", code: "ST-TEST", enabled: true, printerName: null, paperSize: "4x6" as const, orientation: "landscape" as const }, jobs: held ? [{ id, attempt: job.attempt, status: job.status, copies: 1, strip: false, backup: job.backup, sha256, url: "x" } as StationJob] : [] };
    },
    async report(_: string, b: { attempt: number; status: string; error: string | null; safe: boolean }) {
      if (!job.mine || b.attempt !== job.attempt || !["CLAIMED", ...(b.status === "PRINTING" ? [] : ["PRINTING"])].includes(job.status)) throw new CloudError(409, "NOT_YOURS", "moved");
      if (b.status === "FAILED" && b.safe && job.requeues < 6) { job.requeues++; job.attempt++; job.status = "CLAIMED"; job.error = b.error; return; } // back in line; here nobody else takes it
      job.status = b.status; job.error = b.error;
    },
    async download() { return image; },
  };
  const printer: PrinterProvider = {
    kind: "simulated", async discover() { return []; }, async getStatus() { return null; }, async cancelPrint() {},
    async submitPrint() { prints++; return { providerJobId: `p${prints}` }; },
    async getJobStatus(): Promise<JobState> { return { state: "completed" }; },
  };
  return { id, job, cloud, printer, prints: () => prints };
}

/** An agent process over a store. `killAt` = the step (store write, network call, printer call) at which it dies. */
function boot(w: ReturnType<typeof world>, store: Store, killAt = Infinity, hw: { error: string | null } = { error: null }) {
  let step = 0;
  const dead = () => step >= killAt;
  // Each step dies either just before or just after it took effect.
  const mortal = <T extends object>(o: T, names: string[]) => new Proxy(o, {
    get(t, k) {
      const v = (t as Record<string | symbol, unknown>)[k];
      if (typeof v !== "function") return v;
      if (!names.includes(String(k))) return (...a: unknown[]) => { if (dead()) throw new Error("killed"); return v.apply(t, a); };
      return (...a: unknown[]) => {
        if (dead() || ++step >= killAt) throw new Error("killed");
        const r = v.apply(t, a);
        step++;
        if (!dead()) return r;
        if (r instanceof Promise) return r.then(() => { throw new Error("killed"); });
        throw new Error("killed");
      };
    },
  });
  const st = mortal(store, ["set", "insertJob", "updateJob"]);
  const queue = new PrintQueue(st, () => mortal(w.printer, ["submitPrint"]), dir);
  const station = new Station(st, queue, mortal(w.cloud, ["poll", "report", "download"]), async () => ({ error: hw.error, printers: [] }));
  return {
    station, queue,
    steps: () => step,
    async run(ticks = 8) {
      try { queue.start(); } catch { /* killed */ }
      queue.stop();
      for (let i = 0; i < ticks; i++) {
        await station.tick().catch(() => undefined);
        await settle();
        await (queue as unknown as { poll(): Promise<void> }).poll().catch(() => undefined);
      }
    },
  };
}
const open = () => new Store(mkdtempSync(join(tmpdir(), "pbooth-stdb-")));
process.on("unhandledRejection", () => undefined); // a killed process leaves its background work unfinished

describe("print station", () => {
  it("prints a job once and reports it done", async () => {
    const w = world();
    await boot(w, open()).run();
    expect(w.prints()).toBe(1);
    expect(w.job.status).toBe("DONE");
    expect(w.cloud.ready[0]).toBe(false); // not ready until it knows its printer
    expect(w.cloud.ready.at(-1)).toBe(true);
  });

  it("killed at any step, it never prints twice, and the job always ends as printed or as failed for staff", async () => {
    const full = world(), probe = boot(full, open());
    await probe.run();
    const total = probe.steps();
    expect(total).toBeGreaterThan(12);
    const ends: Record<string, number> = {};
    for (let at = 1; at <= total; at++) {
      const w = world(), store = open();
      await boot(w, store, at).run(4); // dies at this step…
      await boot(w, store).run();      // …and is started again
      expect(w.prints(), `killed at step ${at}`).toBeLessThanOrEqual(1);
      expect(["DONE", "FAILED"], `killed at step ${at}: ${w.job.status}`).toContain(w.job.status);
      if (w.job.status === "DONE") expect(w.prints(), `killed at step ${at}`).toBe(1);
      else expect(w.job.error).toMatch(/Check the printer/);
      ends[w.job.status] = (ends[w.job.status] ?? 0) + 1;
    }
    expect(ends.DONE).toBeGreaterThan(ends.FAILED); // most kills recover by themselves
  }, 60_000);

  it("prints again only when staff ask, once per ask", async () => {
    const w = world(), store = open();
    const ok = w.printer.submitPrint;
    w.printer.submitPrint = async () => { throw new Error("lp didn't answer"); }; // may have printed
    const a = boot(w, store);
    await a.run(3);
    expect(w.job).toMatchObject({ status: "FAILED", requeues: 0 });
    expect(w.job.error).toMatch(/Check the printer/);
    w.printer.submitPrint = ok;
    await a.run(3);
    expect(w.prints()).toBe(0);
    Object.assign(w.job, { status: "CLAIMED", attempt: 2 });
    await a.run(6);
    expect(w.job.status).toBe("DONE");
    expect(w.prints()).toBe(1);
  });

  it("a refused print goes back in line by itself, and prints once the printer takes it", async () => {
    const w = world(), store = open();
    const ok = w.printer.submitPrint;
    let refusals = 0;
    w.printer.submitPrint = async (j) => { if (refusals++ < 1) throw new NotPrinted("busy"); return ok.call(w.printer, j); };
    const a = boot(w, store);
    await a.run(2);
    store.updateJob(w.id, { status: "failed", error: "busy" }); store.set(`safe:${w.id}`, "1"); // out of tries
    await a.run(6);
    expect(w.job).toMatchObject({ status: "DONE", requeues: 1 });
    expect(w.prints()).toBe(1);
  });

  it("never prints without the cloud's yes: one given to a backup meanwhile is left alone", async () => {
    const w = world();
    const report = w.cloud.report.bind(w.cloud);
    w.cloud.report = async (id, b) => { if (b.status === "PRINTING" && w.job.attempt === 1) { w.job.mine = false; w.job.attempt = 2; } return report(id, b); };
    await boot(w, open()).run();
    expect(w.prints()).toBe(0);
  });

  it("hands a print back when the printer has a problem, before and after it reached the printer", async () => {
    const w = world(), hw = { error: "Printer stopped: paper out" as string | null };
    const a = boot(w, open(), Infinity, hw);
    await a.station.tick(); // learns its settings
    w.job.status = "CLAIMED";
    hw.error = "Printer stopped: paper out";
    const before = w.job.requeues;
    await a.station.tick();
    expect(w.job.requeues).toBe(before + 1);
    expect(w.prints()).toBe(0);

    // it's in the printer's own queue when the paper runs out, and a backup could print it
    for (const [seen, after, safe] of [["queued", "unknown", true], ["printing", "unknown", false], ["queued", "queued", false]] as const) {
      const v = world(), store = open();
      let cancelled = false;
      v.printer.getJobStatus = async () => ({ state: cancelled ? after : seen });
      v.printer.cancelPrint = async () => { cancelled = true; };
      const b = boot(v, store);
      await b.run(2);
      expect(v.job.status).toBe("PRINTING");
      await b.queue.abandon(v.id, "Printer stopped");
      expect(cancelled).toBe(true);
      expect(b.queue.isSafe(v.id), `${seen} then ${after}`).toBe(safe);
      if (!safe) { await b.run(1); expect(v.job).toMatchObject({ status: "FAILED", requeues: 0 }); }
    }
  });

  it("drops a queued job staff moved elsewhere, and prints it if they send it back", async () => {
    const w = world(), store = open();
    const ok = w.printer.submitPrint;
    w.printer.submitPrint = async () => { throw new NotPrinted("offline"); };
    const a = boot(w, store);
    await a.run(1);
    w.job.mine = false;
    await a.run(2);
    expect(store.job(w.id)!.status).toBe("cancelled");
    w.printer.submitPrint = ok;
    Object.assign(w.job, { mine: true, status: "CLAIMED", attempt: 3 });
    await a.run();
    expect(w.job.status).toBe("DONE");
    expect(w.prints()).toBe(1);
  });

  it("refuses a damaged download, and a job whose record it lost while printing", async () => {
    const w = world();
    w.cloud.download = async () => Buffer.from("not the photo");
    await boot(w, open()).run(26); // 3 tries, handed back 6 times, then staff
    expect(w.job).toMatchObject({ status: "FAILED" });
    expect(w.prints()).toBe(0);
    const v = world();
    v.job.status = "PRINTING";
    await boot(v, open()).run(2);
    expect(v.job.error).toMatch(/no record/);
    expect(v.prints()).toBe(0);
  });
});
