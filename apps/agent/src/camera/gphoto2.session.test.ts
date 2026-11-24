import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GPhoto2Camera } from "./gphoto2.js";

// A fake gphoto2 that behaves like a real camera on USB: only one gphoto2 can hold it at a time,
// live view streams JPEGs until Ctrl-C (which releases the camera), and a hard kill leaves the camera
// stuck busy (what a Nikon D3400 did before live view was stopped gracefully).
const FAKE = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const lock = path.join(process.env.FAKE_CAM_DIR, "busy");
const a = process.argv.slice(2);
const busy = () => { process.stderr.write("*** Error (-53: 'Could not claim the USB device') ***\\n"); process.exit(1); };
if (a.includes("--auto-detect")) { console.log("Model                          Port\\n----------\\nNikon DSC D3400                usb:001,001"); process.exit(0); }
if (a.includes("--capture-movie")) {
  if (fs.existsSync(lock)) busy();
  fs.writeFileSync(lock, "live");
  const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const t = setInterval(() => process.stdout.write(jpeg), 10);
  process.on("SIGINT", () => { clearInterval(t); fs.rmSync(lock, { force: true }); process.exit(0); });
  process.on("SIGTERM", () => process.exit(0)); // abrupt: the camera stays claimed
} else if (a.includes("--capture-image-and-download")) {
  if (fs.existsSync(lock)) busy();
  const file = a[a.indexOf("--filename") + 1].replace(/%[A-Za-z]/g, "1").replace(/\\.1$/, ".jpg");
  fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 9, 0xff, 0xd9]));
  console.log("Saving file as " + file);
} else process.exit(1);
`;

describe.skipIf(process.platform === "win32")("gphoto2 live view around captures (fake camera)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pbooth-fakecam-"));
  const PATH = process.env.PATH;
  beforeAll(() => {
    writeFileSync(join(dir, "gphoto2"), FAKE);
    chmodSync(join(dir, "gphoto2"), 0o755);
    process.env.PATH = `${dir}:${PATH}`;
    process.env.FAKE_CAM_DIR = dir;
  });
  afterAll(() => { process.env.PATH = PATH; });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("pauses live view for each shot and resumes it on the same stream, shot after shot", async () => {
    const cam = new GPhoto2Camera();
    expect((await cam.connect()).status).toBe("connected");
    let frames = 0, ended = false;
    const stop = await cam.liveView(() => frames++, () => { ended = true; });
    await wait(400);
    expect(frames).toBeGreaterThan(0);

    for (let shot = 1; shot <= 3; shot++) {
      const c = await cam.capture(dir); // fails with "camera busy" if live view didn't let go
      expect((await cam.downloadImage(c)).length).toBeGreaterThan(0);
      const before = frames;
      await wait(400);
      expect(frames, `live view after shot ${shot}`).toBeGreaterThan(before);
    }
    expect(ended).toBe(false); // the kiosk's stream was never closed

    stop();
    await wait(300);
    const after = frames;
    await wait(300);
    expect(frames).toBe(after); // stopped for real
    await cam.capture(dir); // and the camera is free again
    await cam.disconnect();
  }, 20_000);
});
