// Converting between "the venue's wall clock" and exact UTC instants, using only the
// built-in Intl time-zone database (no date library needed).

export function isValidTimeZone(tz: string): boolean {
  return tz === "UTC" || Intl.supportedValuesOf("timeZone").includes(tz);
}

function parts(ts: number, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(ts).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

// Milliseconds the zone is ahead of UTC at instant ts (e.g. -8h for Los Angeles in winter).
function offset(ts: number, timeZone: string) {
  const p = parts(ts, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
}

/** "2026-12-05" + "18:30" in "America/Los_Angeles" → the exact Date. */
export function wallTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes handle the offset changing between the guess and the answer (DST days).
  let ts = asUtc - offset(asUtc, timeZone);
  const second = offset(ts, timeZone);
  if (asUtc - second !== ts) ts = asUtc - second;
  return new Date(ts);
}

/** The exact Date → { date: "2026-12-05", time: "18:30" } on the venue's clock. */
export function utcToWallTime(at: Date, timeZone: string) {
  const p = parts(at.getTime(), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** Event times: an end at or before the start means the event runs past midnight. */
export function eventWindow(date: string, startTime: string, endTime: string, timeZone: string) {
  const startsAt = wallTimeToUtc(date, startTime, timeZone);
  let endsAt = wallTimeToUtc(date, endTime, timeZone);
  if (endsAt <= startsAt) {
    const next = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1)).toISOString().slice(0, 10);
    endsAt = wallTimeToUtc(next, endTime, timeZone);
  }
  return { startsAt, endsAt };
}
