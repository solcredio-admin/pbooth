import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { CameraProvider, CameraState, Captured } from "./types.js";

// SIMULATED camera for development (agent --simulate). Produces labelled test frames, reports
// itself as simulated everywhere, and never stands in for real compatibility.
const frame = (w: number, h: number, label: string) => {
  const hue = Math.floor(Date.now() / 40) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 90) % 360},50%,30%)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w / 2}" cy="${h * 0.42}" r="${h * 0.16}" fill="rgba(255,255,255,.75)"/>
    <ellipse cx="${w / 2}" cy="${h * 1.05}" rx="${h * 0.4}" ry="${h * 0.42}" fill="rgba(255,255,255,.75)"/>
    <text x="${w * 0.04}" y="${h * 0.1}" font-family="monospace" font-size="${h * 0.05}" fill="#fff">SIMULATED CAMERA · ${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
};

export class SimulatedCamera implements CameraProvider {
  readonly kind = "simulated" as const;
  private state: CameraState = { status: "disconnected" };
  async discover() { return [{ id: "sim:0", name: "Simulated DSLR", provider: "simulated" as const }]; }
  async connect() { return (this.state = { status: "connected", name: "Simulated DSLR", model: "Simulated DSLR", compatibility: "simulated" }); }
  async disconnect() { this.state = { status: "disconnected" }; }
  getStatus() { return this.state; }
  getCapabilities() { return { liveView: true, capture: true, settings: [] }; }
  async capture(dir: string): Promise<Captured> {
    const path = join(dir, `capture-sim-${Date.now()}.jpg`);
    await writeFile(path, await frame(3000, 2000, new Date().toISOString().slice(11, 19)));
    return { path };
  }
  async downloadImage(c: Captured) { const { readFile } = await import("node:fs/promises"); return readFile(c.path); }
  async getSettings() { return {}; }
  async updateSettings() {}
  async liveView(onFrame: (jpeg: Buffer) => void) {
    let on = true;
    const tick = async () => { while (on) { onFrame(await frame(960, 640, "LIVE")); await new Promise((r) => setTimeout(r, 80)); } };
    void tick();
    return () => { on = false; };
  }
}

/** Windows DSLR: honestly unsupported in v1. */
export class UnsupportedCamera implements CameraProvider {
  readonly kind = "unsupported" as const;
  constructor(private readonly reason: string) {}
  async discover() { return []; }
  async connect() { return this.getStatus(); }
  async disconnect() {}
  getStatus(): CameraState { return { status: "unsupported", error: this.reason, compatibility: "unsupported" }; }
  getCapabilities() { return { liveView: false, capture: false, settings: [] }; }
  async capture(): Promise<Captured> { throw new Error(this.reason); }
  async downloadImage(): Promise<Buffer> { throw new Error(this.reason); }
  async getSettings() { return {}; }
  async updateSettings() { throw new Error(this.reason); }
  async liveView(_f: (j: Buffer) => void, onEnd: (e?: string) => void) { onEnd(this.reason); return () => undefined; }
}
