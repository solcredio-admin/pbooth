// What every camera integration must provide (matches the platform spec).
export type CameraStatus = "connected" | "disconnected" | "error" | "unsupported";
export type Compatibility = "tested" | "untested" | "unsupported" | "simulated";

export interface CameraInfo { id: string; name: string; provider: "gphoto2" | "simulated" }
export interface CameraState { status: CameraStatus; name?: string; model?: string; error?: string; compatibility?: Compatibility }
export interface Capabilities { liveView: boolean; capture: boolean; settings: string[] }
export interface Captured { path: string }

export interface CameraProvider {
  readonly kind: "gphoto2" | "simulated" | "unsupported";
  discover(): Promise<CameraInfo[]>;
  connect(preferredName?: string | null): Promise<CameraState>;
  disconnect(): Promise<void>;
  getStatus(): CameraState;
  getCapabilities(): Capabilities;
  capture(dir: string): Promise<Captured>;
  downloadImage(c: Captured): Promise<Buffer>;
  getSettings(): Promise<Record<string, { current: string; choices: string[] }>>;
  updateSettings(changes: Record<string, string>): Promise<void>;
  /** Calls onFrame with JPEG frames until the returned stop() is called. */
  liveView(onFrame: (jpeg: Buffer) => void, onEnd: (error?: string) => void): Promise<() => void>;
}
