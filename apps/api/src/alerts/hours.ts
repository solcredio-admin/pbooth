/** Is "HH:MM" inside from–to? Wraps past midnight (18:00–02:00). No window means always. */
export function withinHours(now: string, from: string | null, to: string | null) {
  if (!from || !to || from === to) return true;
  return from < to ? now >= from && now < to : now >= from || now < to;
}
