import type { EventDto, EventStatus } from "./types";

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
