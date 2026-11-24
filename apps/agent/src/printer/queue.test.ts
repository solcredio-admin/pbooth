import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { PrintQueue } from "./queue.js";
import { preparePrint } from "./image.js";
import { listedJobs, parsePrinters, parseRequestId } from "./cups.js";
import { NotPrinted, type PrinterProvider, type Submit } from "./types.js";

const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#888" } }).jpeg().toBuffer();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakePrinter implements PrinterProvider {
  readonly kind = "simulated" as const;
  submitted: Submit[] = [];
  failNext = 0;
  async discover() { return []; }
  async getStatus() { return null; }
  async submitPrint(j: Submit) {
    if (this.failNext-- > 0) throw new NotPrinted("printer busy");
    this.submitted.push(j);
    return { providerJobId: `p-${this.submitted.length}` };
  }
  async getJobStatus() { return { state: "completed" as const }; }
  async cancelPrint() {}
}

describe("print queue", () => {
  const dir = mkdtempSync(join(tmpdir(), "pbooth-q-"));

  it("prints once per job id, even if asked twice", async () => {
    const fake = new FakePrinter();
    const q = new PrintQueue(new Store(":memory:"), () => fake, dir);
    const img = await jpeg(600, 1800);
    const a = await q.submit("job-1", img, { printer: null, copies: 2, paper: "2x6", orientation: "portrait" });
    const b = await q.submit("job-1", img, { printer: null, copies: 2, paper: "2x6", orientation: "portrait" });
    await wait(50);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(fake.submitted).toHaveLength(1);
    expect(fake.submitted[0].copies).toBe(2);
  });

  it("retries a refused hand-off, then gives up with the reason", async () => {
    const fake = new FakePrinter();
    fake.failNext = 1;
    const store = new Store(":memory:");
    const q = new PrintQueue(store, () => fake, dir);
    await q.submit("job-2", await jpeg(1800, 1200), { printer: null, copies: 1, paper: "4x6", orientation: "landscape" });
    await wait(50);
    expect(store.job("job-2")!.status).toBe("queued");
    expect(store.job("job-2")!.error).toBe("printer busy");
  });

  it("after a restart, never re-sends a job that was mid-hand-off", async () => {
    const store = new Store(":memory:");
    store.insertJob({ id: "job-3", printer: null, copies: 1, paper: "4x6", orientation: "portrait", file: "/x.jpg" });
    store.updateJob("job-3", { status: "submitting" });
    const fake = new FakePrinter();
    const q = new PrintQueue(store, () => fake, dir);
    q.start(); q.stop();
    expect(store.job("job-3")!.status).toBe("failed");
    expect(store.job("job-3")!.error).toMatch(/double print/);
    expect(fake.submitted).toHaveLength(0);
  });

  it("fails clearly when the booth has no printer", async () => {
    const store = new Store(":memory:");
    const q = new PrintQueue(store, () => null, dir);
    await q.submit("job-4", await jpeg(100, 150), { printer: null, copies: 1, paper: "4x6", orientation: "portrait" });
    await wait(20);
    expect(store.job("job-4")!.status).toBe("failed");
  });
});

describe("print-ready images", () => {
  it("puts two 2x6 strips side by side on 4x6 at 300 dpi", async () => {
    const r = await preparePrint(await jpeg(600, 1800), "2x6", "portrait");
    const m = await sharp(r.buffer).metadata();
    expect([m.width, m.height, m.density]).toEqual([1200, 1800, 300]);
  });
  it("fills 4x6 landscape, rotating a portrait photo to fit", async () => {
    const r = await preparePrint(await jpeg(1200, 1800), "4x6", "landscape");
    const m = await sharp(r.buffer).metadata();
    expect([m.width, m.height, r.landscape]).toEqual([1800, 1200, true]);
  });
});

describe("CUPS output parsing", () => {
  it("reads printers, the default and stopped reasons", () => {
    const p = "printer DNP_DS620 is idle.  enabled since Sat 22 Nov\nprinter PDF disabled since Sat 22 Nov -\n\tPaper out\nprinter Office now printing PDF-3.  enabled since x\n";
    expect(parsePrinters(p, "system default destination: DNP_DS620")).toEqual([
      { name: "DNP_DS620", isDefault: true, status: "idle" },
      { name: "PDF", isDefault: false, status: "stopped", message: "Paper out" },
      { name: "Office", isDefault: false, status: "printing" },
    ]);
  });
  it("reads lp and lpstat -o", () => {
    expect(parseRequestId("request id is PDF-12 (1 file(s))")).toBe("PDF-12");
    expect([...listedJobs("PDF-12   don   1024   Sat 22 Nov\nPDF-13  don  2  x\n")]).toEqual(["PDF-12", "PDF-13"]);
  });
});
