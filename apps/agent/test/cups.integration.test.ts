// Real CUPS + real gPhoto2 inside the test container (test/hardware.Dockerfile). Skipped elsewhere.
// Proves the agent drives the actual tools end to end; it says nothing about specific printer
// or camera models, which still need testing on real hardware.
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CupsPrinter } from "../src/printer/cups.js";
import { PrintQueue } from "../src/printer/queue.js";
import { Store } from "../src/store.js";
import { GPhoto2Camera } from "../src/camera/gphoto2.js";

const on = process.env.HARDWARE_INTEGRATION === "1";

describe.skipIf(!on)("real CUPS printing (virtual PDF printer)", () => {
  it("finds the printer and the default", async () => {
    const printers = await new CupsPrinter().discover();
    expect(printers.find((p) => p.name === "PDF")).toMatchObject({ isDefault: true });
  });

  it("prints a 2x6 strip through the queue and sees it complete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pbooth-cups-"));
    const store = new Store(":memory:");
    const q = new PrintQueue(store, () => new CupsPrinter(), dir);
    q.start();
    const strip = await sharp({ create: { width: 600, height: 1800, channels: 3, background: "#1b1730" } }).jpeg().toBuffer();
    const id = crypto.randomUUID();
    await q.submit(id, strip, { printer: "PDF", copies: 1, paper: "2x6", orientation: "portrait" });
    let job = store.job(id)!;
    for (let i = 0; i < 40 && job.status !== "completed" && job.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      job = store.job(id)!;
    }
    q.stop();
    expect(job.error).toBeNull();
    expect(job.status).toBe("completed");
    expect(job.provider_job_id).toMatch(/^PDF-\d+$/);
    // cups-pdf writes to the submitting user's ~/PDF, naming the file after the job title.
    const out = join(process.env.HOME ?? "/root", "PDF");
    expect(existsSync(out) && readdirSync(out).some((f) => f.includes(id) && f.endsWith(".pdf"))).toBe(true);
  }, 60_000);
});

describe.skipIf(!on)("real gPhoto2 with no camera attached", () => {
  it("reports no camera honestly instead of pretending", async () => {
    const cam = new GPhoto2Camera();
    expect(await cam.discover()).toEqual([]);
    const s = await cam.connect();
    expect(s.status).toBe("disconnected");
    expect(s.error).toMatch(/No camera found/);
  });
});
