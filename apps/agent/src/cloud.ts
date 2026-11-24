// The agent's side of the device API (docs/DEVICE_API.md).
export interface DeviceConfig {
  version: string;
  booth: { id: string; name: string; code: string };
  camera: { provider: "webcam" | "gphoto2"; deviceName: string | null; resolution: string; orientation: "landscape" | "portrait"; mirrorPreview: boolean };
  printer: { enabled: boolean; printerName: string | null; paperSize: "4x6" | "2x6" | "5x7"; orientation: "portrait" | "landscape" };
  stationHere?: boolean; // this booth's own token also runs a station
  heartbeatIntervalSeconds: number;
  event: null | { id: string; name: string; guest: null | { printEnabled: boolean; printCopies: number } };
}

export interface StationSettings { id: string; name: string; code: string; enabled: boolean; printerName: string | null; paperSize: "4x6" | "2x6" | "5x7"; orientation: "portrait" | "landscape" }
export interface StationJob { id: string; attempt: number; status: "CLAIMED" | "PRINTING"; copies: number; strip: boolean; backup: boolean; sha256: string; url: string }
export type Enrolled = { token: string } & ({ localSecret: string; booth: { id: string; name: string; code: string } } | { station: { id: string; name: string; code: string } });

export class CloudError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string) { super(message); }
}

export class Cloud {
  constructor(private readonly server: string, private token?: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.server}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new CloudError(res.status, json?.error?.code, json?.error?.message ?? `HTTP ${res.status}`);
    return json as T;
  }

  enroll(body: { code: string; simulated: boolean; stations: boolean; device: { identifier: string; hostname: string; os: string; agentVersion: string } }) {
    return this.call<Enrolled>("POST", "/devices/enroll", body);
  }
  heartbeat(body: unknown) {
    return this.call<{ configVersion: string; heartbeatIntervalSeconds: number }>("POST", "/devices/heartbeat", body);
  }
  config() { return this.call<DeviceConfig>("GET", "/devices/config"); }
  poll(body: unknown) { return this.call<{ station: StationSettings; jobs: StationJob[] }>("POST", "/station/poll", body); }
  report(id: string, body: { attempt: number; status: string; error: string | null; safe: boolean }) { return this.call("POST", `/station/jobs/${id}`, body); }
  async download(url: string) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) }); // a signed link: never sent our token
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  ack(version: string) { return this.call("POST", "/devices/config/ack", { version }); }
}
