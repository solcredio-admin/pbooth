// The agent's side of the device API (docs/DEVICE_API.md).
export interface DeviceConfig {
  version: string;
  booth: { id: string; name: string; code: string };
  camera: { provider: "webcam" | "gphoto2"; deviceName: string | null; resolution: string; orientation: "landscape" | "portrait"; mirrorPreview: boolean };
  printer: { enabled: boolean; printerName: string | null; paperSize: "4x6" | "2x6" | "5x7"; orientation: "portrait" | "landscape" };
  heartbeatIntervalSeconds: number;
  event: null | { id: string; name: string; guest: null | { printEnabled: boolean; printCopies: number } };
}

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

  enroll(body: { code: string; simulated: boolean; device: { identifier: string; hostname: string; os: string; agentVersion: string } }) {
    return this.call<{ token: string; localSecret: string; booth: { id: string; name: string; code: string }; heartbeatIntervalSeconds: number }>("POST", "/devices/enroll", body);
  }
  heartbeat(body: unknown) {
    return this.call<{ configVersion: string; heartbeatIntervalSeconds: number }>("POST", "/devices/heartbeat", body);
  }
  config() { return this.call<DeviceConfig>("GET", "/devices/config"); }
  ack(version: string) { return this.call("POST", "/devices/config/ack", { version }); }
}
