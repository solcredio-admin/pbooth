import type { BoothDto, BoothStatus, EventDto, EventStatus } from "./types";

export const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: "Draft", SCHEDULED: "Scheduled", ACTIVE: "Live", COMPLETED: "Completed", ARCHIVED: "Archived",
};
export const STATUS_SHORT: Record<EventStatus, string> = {
  DRAFT: "Draft", SCHEDULED: "Sched", ACTIVE: "Live", COMPLETED: "Done", ARCHIVED: "Arch",
};

/** "Sat, Dec 5, 2026" on the venue's clock. */
export const longDate = (e: EventDto) =>
  new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(e.startsAt));

/** "DEC 05" for keycaps. */
export const capDate = (e: EventDto) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, month: "short", day: "2-digit" }).formatToParts(new Date(e.startsAt));
  return `${p.find((x) => x.type === "month")?.value} ${p.find((x) => x.type === "day")?.value}`.toUpperCase();
};

/** "6:00 PM – 1:00 AM GMT+8" */
export const timeRange = (e: EventDto) => {
  const t = (iso: string, zone = false) => new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, hour: "numeric", minute: "2-digit", ...(zone ? { timeZoneName: "short" } : {}) }).format(new Date(iso));
  return `${t(e.startsAt)} – ${t(e.endsAt, true)}`;
};


export const BOOTH_LABEL: Record<BoothStatus, string> = {
  UNREGISTERED: "Not enrolled", READY: "Enrolled", ONLINE: "Online", OFFLINE: "Offline", ACTIVE: "Live", ERROR: "Error", REVOKED: "Revoked",
};
export const BOOTH_SHORT: Record<BoothStatus, string> = {
  UNREGISTERED: "New", READY: "Ready", ONLINE: "On", OFFLINE: "Off", ACTIVE: "Live", ERROR: "Err", REVOKED: "Rev",
};
export const boothTile = (b: BoothDto) =>
  b.status === "ONLINE" || b.status === "ACTIVE" ? "key" : b.status === "READY" ? "key sched" : b.status === "ERROR" || b.status === "REVOKED" ? "key err" : "key local";

/** "just now", "42 s ago", "5 min ago", "3 h ago", "Nov 20" */
export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}

export function bytes(n: number | undefined) {
  if (n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
