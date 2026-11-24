// Shapes returned by the API (apps/api/src/events/events.service.ts → toDto).
export type EventStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
export type Transition = "schedule" | "activate" | "complete" | "archive";

export interface EventConfig {
  welcomeTitle: string; welcomeMessage: string; primaryColor: string; accentColor: string;
  countdownSeconds: number; shotsPerSession: number; captureIntervalSeconds: number; previewSeconds: number;
  layout: "landscape" | "strip" | "grid"; footerText: string;
  pattern: "none" | "dots" | "stripes" | "grid" | "confetti" | "waves" | "gradient";
  frameStyle: "line" | "double" | "corners" | "none"; photoStyle: "rounded" | "square" | "white"; fontStyle: "serif" | "sans" | "mono"; showDate: boolean; logo: string | null; logoPosition: "left" | "center" | "right"; logoSize: number; printEnabled: boolean; printCopies: number;
  galleryEnabled: boolean; galleryRetentionDays: number; saveOriginals: boolean;
}

export interface EventDto {
  id: string; name: string; organizerName: string | null; contactPhone: string | null; contactEmail: string | null; venueName: string | null; venueAddress: string | null;
  status: EventStatus; timeZone: string; startsAt: string; endsAt: string;
  kind: "MANAGED" | "SELF_SERVICE"; priceCentavos: number; currency: string; freeSessions: boolean; acceptVouchers: boolean; acceptQr: boolean;
  partnerName: string | null; partnerSharePercent: number | null; cashiers: { id: string; username: string }[];
  local: { date: string; startTime: string; endTime: string };
  activatedAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string;
  config: EventConfig | null; actions: Transition[];
}

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export interface Summary { total: number; byStatus: Record<EventStatus, number> }
export interface ApiErrorBody { error: { code: string; message: string; details?: { path: string; message: string }[] } }

export type BoothStatus = "UNREGISTERED" | "READY" | "ONLINE" | "OFFLINE" | "ACTIVE" | "ERROR" | "REVOKED";
export interface HwStatus { status: "connected" | "disconnected" | "error" | "unsupported"; name?: string }
export interface CameraConfig { provider: "webcam" | "gphoto2"; deviceName: string | null; resolution: "auto" | "720p" | "1080p" | "4k"; orientation: "landscape" | "portrait"; rotation: 0 | 90 | 180 | 270; mirrorPreview: boolean }
export interface PrinterConfig { enabled: boolean; printerName: string | null; paperSize: "4x6" | "2x6" | "5x7"; orientation: "portrait" | "landscape" }

export interface SessionStats { sessions: number; completed: number; photos: number }
export interface EventSessions { byBooth: Record<string, SessionStats>; total: SessionStats }

export interface BoothDto {
  id: string; name: string; code: string; notes: string | null; state: "UNREGISTERED" | "READY" | "REVOKED";
  status: BoothStatus; online: boolean; simulated: boolean;
  camera: CameraConfig; printer: PrinterConfig; configVersion: string; configApplied: boolean;
  device: null | {
    hostname: string | null; os: string | null; agentVersion: string | null; identifier: string; enrolledAt: string;
    lastHeartbeatAt: string | null; lastError: string | null; appliedConfigVersion: string | null;
    telemetry: {
      storage?: { freeBytes: number; totalBytes: number }; pendingUploads?: number; pendingPrints?: number;
      camera?: HwStatus & { compatibility?: "tested" | "untested" | "unsupported" | "simulated"; model?: string }; printer?: HwStatus;
      printJobs?: { queued: number; failed: number; completedToday: number };
      cameras?: { id: string; name: string; provider: "webcam" | "gphoto2" }[]; printers?: { name: string; isDefault?: boolean }[];
    };
  };
  lastSeenAt: string | null;
  lastError: string | null;
  kiosk: null | {
    pairedAt: string; lastSeenAt: string | null; userAgent: string | null; lastError: string | null; online: boolean;
    telemetry: {
      camera?: { status: string; name?: string; resolution?: string }; cameras?: { id: string; name: string; provider: string }[];
      queue?: { pending: number; failed: number; lastSyncAt: string | null }; // the kiosk's offline outbox
    };
  };
  kioskCodeExpiresAt: string | null;
  liveEvent: { id: string; name: string } | null;
  events: { id: string; name: string; status: EventStatus; startsAt: string; timeZone: string }[];
  nextEvent: { id: string; name: string; startsAt: string } | null;
  enrollmentExpiresAt: string | null;
  offlineAfterSeconds: number;
  createdAt: string;
}

export interface EventPhotos {
  storageEnabled: boolean; galleryEnabled: boolean; saveOriginals: boolean; retentionDays: number; eventGalleryToken: string | null;
  counts: Partial<Record<"PENDING" | "UPLOADED" | "PROCESSING" | "PROCESSED" | "FAILED" | "DELETED", number>>;
  page: number; pageSize: number; total: number;
  sessions: {
    id: string; startedAt: string; status: string; booth: { name: string; code: string } | null; galleryToken: string | null;
    photos: { id: string; kind: "DESIGN" | "ORIGINAL"; index: number; status: string; error: string | null; thumbUrl: string | null; downloadUrl?: string | null }[];
  }[];
}
