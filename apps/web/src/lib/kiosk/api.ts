// Kiosk → API. The kiosk's HttpOnly cookie rides along automatically; nothing secret lives here.
export interface KioskConfig {
  version: string;
  storage: boolean; // photos can be saved and shared by QR
  galleryRetentionDays: number;
  booth: { id: string; name: string; code: string };
  camera: import("./camera").CameraSettings;
  printer: { enabled: boolean; printerName: string | null; paperSize: string; orientation: string };
  heartbeatIntervalSeconds: number;
  event: null | {
    id: string; name: string; timeZone: string; startsAt: string; endsAt: string;
    guest: null | { welcomeTitle: string; welcomeMessage: string; primaryColor: string; accentColor: string; countdownSeconds: number; shotsPerSession: number; captureIntervalSeconds: number; printEnabled: boolean; printCopies: number; galleryEnabled: boolean; saveOriginals: boolean;
      template: { layout: "strip" | "grid"; footerText: string; showDate: boolean } };
  };
}

export type KioskResult<T> = { ok: true; data: T } | { ok: false; status: number; code?: string; message: string; details?: unknown };

export async function kioskFetch<T>(method: string, path: string, body?: unknown): Promise<KioskResult<T>> {
  try {
    const res = await fetch(`/api/v1${path}`, {
      method, credentials: "same-origin", cache: "no-store",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, code: json?.error?.code, message: json?.error?.message ?? `HTTP ${res.status}`, details: json?.error?.details };
  } catch {
    return { ok: false, status: 0, message: "offline" };
  }
}
