// Shapes returned by the API (apps/api/src/events/events.service.ts → toDto).
export type EventStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
export type Transition = "schedule" | "activate" | "complete" | "archive";

export interface EventConfig {
  welcomeTitle: string; welcomeMessage: string; primaryColor: string; accentColor: string;
  countdownSeconds: number; shotsPerSession: number; printEnabled: boolean; printCopies: number;
  galleryEnabled: boolean; galleryRetentionDays: number;
}

export interface EventDto {
  id: string; name: string; organizerName: string | null; venueName: string | null; venueAddress: string | null;
  status: EventStatus; timeZone: string; startsAt: string; endsAt: string;
  local: { date: string; startTime: string; endTime: string };
  activatedAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string;
  config: EventConfig | null; actions: Transition[];
}

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export interface Summary { total: number; byStatus: Record<EventStatus, number> }
export interface ApiErrorBody { error: { code: string; message: string; details?: { path: string; message: string }[] } }

export type BoothStatus = "UNREGISTERED" | "READY" | "ONLINE" | "OFFLINE" | "ACTIVE" | "ERROR" | "REVOKED";
export interface HwStatus { status: "connected" | "disconnected" | "error" | "unsupported"; name?: string }
export interface CameraConfig { provider: "webcam" | "gphoto2"; deviceName: string | null; resolution: "auto" | "720p" | "1080p" | "4k"; orientation: "landscape" | "portrait"; mirrorPreview: boolean }
export interface PrinterConfig { enabled: boolean; printerName: string | null; paperSize: "4x6" | "2x6" | "5x7"; orientation: "portrait" | "landscape" }

export interface BoothDto {
  id: string; name: string; code: string; notes: string | null; state: "UNREGISTERED" | "READY" | "REVOKED";
  status: BoothStatus; online: boolean; simulated: boolean;
  camera: CameraConfig; printer: PrinterConfig; configVersion: string; configApplied: boolean;
  device: null | {
    hostname: string | null; os: string | null; agentVersion: string | null; identifier: string; enrolledAt: string;
    lastHeartbeatAt: string | null; lastError: string | null; appliedConfigVersion: string | null;
    telemetry: {
      storage?: { freeBytes: number; totalBytes: number }; pendingUploads?: number; pendingPrints?: number;
      camera?: HwStatus; printer?: HwStatus;
      cameras?: { id: string; name: string; provider: "webcam" | "gphoto2" }[]; printers?: { name: string; isDefault?: boolean }[];
    };
  };
  liveEvent: { id: string; name: string } | null;
  events: { id: string; name: string; status: EventStatus; startsAt: string; timeZone: string }[];
  nextEvent: { id: string; name: string; startsAt: string } | null;
  enrollmentExpiresAt: string | null;
  offlineAfterSeconds: number;
  createdAt: string;
}
