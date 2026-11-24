import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { run } from "../exec.js";
import { compatibilityFor } from "./registry.js";
import type { CameraInfo, CameraProvider, CameraState, Captured } from "./types.js";

// DSLR / mirrorless control through the gphoto2 command-line tool (Linux; macOS works but its
// own camera daemon must be stopped). One camera operation at a time: capture pauses live view.
const SETTINGS = ["iso", "shutterspeed", "aperture", "f-number", "imageformat", "whitebalance"];

/** "gphoto2 --auto-detect" → cameras. Exported for tests. */
export function parseAutoDetect(out: string): CameraInfo[] {
  return out.split("\n").slice(2).map((l) => l.trimEnd()).filter(Boolean)
    .flatMap((l): CameraInfo[] => { const m = /^(.*\S)\s{2,}(\S+)$/.exec(l); return m ? [{ name: m[1], id: m[2], provider: "gphoto2" }] : []; });
}

/** File paths from "Saving file as …" lines; prefers a JPEG when RAW+JPEG is set. */
export function parseSaved(out: string): string[] {
  const files = [...out.matchAll(/Saving file as (.+?)\s*$/gm)].map((m) => m[1]);
  return files.sort((a, b) => Number(/\.jpe?g$/i.test(b)) - Number(/\.jpe?g$/i.test(a)));
}

/** "--get-config x" → current value and choices. */
export function parseConfig(out: string) {
  const current = /^Current: (.*)$/m.exec(out)?.[1]?.trim();
  const choices = [...out.matchAll(/^Choice: \d+ (.*)$/gm)].map((m) => m[1].trim());
  return current === undefined ? null : { current, choices };
}

/** Turns gphoto2's error output into something an operator can act on. */
export function explain(stderr: string): string {
  if (/Could not claim the USB device/i.test(stderr)) return platform() === "darwin"
    ? "Another program has the camera (on a Mac usually Photos or Image Capture). Quit them, then reconnect."
    : "Another program has the camera (on Ubuntu usually gvfs). Run: gio mount -s gphoto2 — then reconnect.";
  if (/No camera found|Could not detect any camera/i.test(stderr)) return "No camera found. Check the USB cable and that the camera is on and not asleep.";
  if (/I\/O in progress|Device Busy/i.test(stderr)) return "The camera is busy. Wait a moment and try again.";
  return stderr.split("\n").find((l) => l.includes("***") || l.trim())?.replace(/\*/g, "").trim() || "Camera error";
}

const LIVE_FPS = 15; // the camera can stream far faster (a D3400 ~120 fps); more only costs CPU and bandwidth
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// macOS's own camera service grabs PTP cameras as soon as they're plugged in; gPhoto2 needs it gone
const freeOnMac = () => (platform() === "darwin" ? run("killall", ["ptpcamerad", "PTPCamera"], { timeoutMs: 5000 }).catch(() => undefined) : Promise.resolve());

/** Splits a stream of concatenated JPEGs (gphoto2 --capture-movie --stdout) into frames. */
export class JpegSplitter {
  private buf = Buffer.alloc(0);
  constructor(private readonly onFrame: (jpeg: Buffer) => void) {}
  push(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const start = this.buf.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) { this.buf = Buffer.alloc(0); return; }
      const end = this.buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) { this.buf = this.buf.subarray(start); if (this.buf.length > 8_000_000) this.buf = Buffer.alloc(0); return; }
      this.onFrame(this.buf.subarray(start, end + 2));
      this.buf = this.buf.subarray(end + 2);
    }
  }
}

export class GPhoto2Camera implements CameraProvider {
  readonly kind = "gphoto2" as const;
  private state: CameraState = { status: "disconnected" };
  private port: string | null = null;
  private live: ChildProcessWithoutNullStreams | null = null;
  // who's watching live view; kept while a capture pauses it, so the same stream resumes after
  private watcher: { onFrame: (jpeg: Buffer) => void; onEnd: (error?: string) => void } | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.busy.then(fn, fn);
    this.busy = next.catch(() => undefined);
    return next;
  }

  private args(...rest: string[]) { return [...(this.port ? ["--port", this.port] : []), ...rest]; }

  async discover() {
    try {
      const r = await run("gphoto2", ["--auto-detect"], { timeoutMs: 15_000 });
      return parseAutoDetect(r.stdout);
    } catch {
      this.state = { status: "error", error: "gPhoto2 is not installed. On Ubuntu: sudo apt install gphoto2" };
      return [];
    }
  }

  async connect(preferredName?: string | null) {
    const cams = await this.discover();
    if (this.state.status === "error" && !cams.length && this.state.error?.includes("not installed")) return this.state;
    const cam = cams.find((c) => c.name === preferredName) ?? cams[0];
    if (!cam) { this.port = null; return (this.state = { status: "disconnected", error: "No camera found. Check the USB cable and that the camera is on." }); }
    this.port = cam.id;
    const compat = compatibilityFor(cam.name, platform() === "darwin" ? "darwin" : "linux");
    return (this.state = { status: "connected", name: cam.name, model: cam.name, compatibility: compat.tested });
  }

  async disconnect() { this.watcher = null; await this.stopLive(); this.port = null; this.state = { status: "disconnected" }; }
  getStatus() { return this.state; }
  getCapabilities() { return { liveView: true, capture: true, settings: SETTINGS }; }

  capture(dir: string): Promise<Captured> {
    return this.exclusive(async () => {
      await this.stopLive(); // pause live view and wait for it to let go of the USB, or the capture finds the camera busy
      try { return await this.shoot(dir); }
      finally { if (this.watcher) this.startLive(); } // the kiosk's live view carries on on the same stream
    });
  }

  private async shoot(dir: string): Promise<Captured> {
    const shoot = () => run("gphoto2", this.args("--capture-image-and-download", "--force-overwrite", "--filename", `${dir}/capture-%Y%m%d-%H%M%S-%n.%C`), { timeoutMs: 30_000 });
    let r = await shoot();
    if (r.code !== 0 && /claim the USB|Device Busy|I\/O in progress/i.test(r.stderr)) { await freeOnMac(); await sleep(400); r = await shoot(); }
    const files = parseSaved(r.stdout);
    if (r.code !== 0 || !files.length) {
      const error = explain(r.stderr);
      this.state = { ...this.state, status: /No camera/.test(error) ? "disconnected" : "error", error };
      throw new Error(error);
    }
    this.state = { ...this.state, status: "connected", error: undefined };
    return { path: files[0] };
  }

  downloadImage(c: Captured) { return readFile(c.path); }

  async getSettings() {
    const out: Record<string, { current: string; choices: string[] }> = {};
    for (const key of SETTINGS) {
      const r = await this.exclusive(() => run("gphoto2", this.args("--get-config", key), { timeoutMs: 10_000 }));
      const parsed = r.code === 0 ? parseConfig(r.stdout) : null;
      if (parsed) out[key] = parsed;
    }
    return out;
  }

  async updateSettings(changes: Record<string, string>) {
    for (const [key, value] of Object.entries(changes)) {
      if (!SETTINGS.includes(key)) throw new Error(`Setting ${key} is not supported`);
      const r = await this.exclusive(() => run("gphoto2", this.args("--set-config", `${key}=${value}`), { timeoutMs: 10_000 }));
      if (r.code !== 0) throw new Error(explain(r.stderr));
    }
  }

  async liveView(onFrame: (jpeg: Buffer) => void, onEnd: (error?: string) => void) {
    await this.busy;
    await this.stopLive();
    await freeOnMac();
    const watcher = { onFrame, onEnd };
    this.watcher = watcher;
    this.startLive();
    return () => { if (this.watcher === watcher) { this.watcher = null; void this.stopLive(); } };
  }

  private startLive() {
    const w = this.watcher;
    if (!w) return;
    const p = spawn("gphoto2", this.args("--capture-movie", "--stdout"));
    this.live = p;
    let last = 0;
    const split = new JpegSplitter((f) => { const now = Date.now(); if (now - last >= 1000 / LIVE_FPS) { last = now; w.onFrame(f); } });
    let stderr = "";
    p.stdout.on("data", (d: Buffer) => split.push(d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", () => { if (this.watcher === w) { this.watcher = null; w.onEnd("gPhoto2 is not installed"); } });
    p.on("close", (code) => {
      if (this.live !== p) return; // we stopped it (a capture pausing it, or the viewer left): not an end
      this.live = null;
      if (this.watcher === w) { this.watcher = null; w.onEnd(code ? explain(stderr) : undefined); }
    });
  }

  /** Stops live view and waits until gPhoto2 has exited (released the camera), killing it after 3 s. */
  private stopLive(): Promise<void> {
    const p = this.live;
    if (!p) return Promise.resolve();
    this.live = null;
    return new Promise((done) => {
      if (p.exitCode !== null || p.signalCode !== null) return done();
      const force = setTimeout(() => p.kill("SIGKILL"), 3000);
      p.once("close", () => { clearTimeout(force); done(); });
      p.kill("SIGINT"); // like Ctrl-C: gPhoto2 ends live view on the camera properly (a hard kill can leave it stuck)
    });
  }
}
