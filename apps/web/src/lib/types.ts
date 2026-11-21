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
