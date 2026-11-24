// The booth status the admin sees, derived from facts instead of stored, so it can't go stale:
//   REVOKED       access withdrawn
//   UNREGISTERED  no device enrolled
//   READY         enrolled, has never checked in
//   OFFLINE       no heartbeat within the offline window
//   ERROR         online, but the device reports an error
//   ACTIVE        online and assigned to a live event
//   ONLINE        online, nothing live
export type BoothStatus = "UNREGISTERED" | "READY" | "ONLINE" | "OFFLINE" | "ACTIVE" | "ERROR" | "REVOKED";

export interface StatusFacts {
  state: "UNREGISTERED" | "READY" | "REVOKED";
  hasDevice: boolean;
  lastHeartbeatAt: Date | null;
  lastError: string | null;
  hasLiveEvent: boolean;
}

export function isOnline(lastHeartbeatAt: Date | null, offlineAfterSeconds: number, now = new Date()) {
  return !!lastHeartbeatAt && now.getTime() - lastHeartbeatAt.getTime() <= offlineAfterSeconds * 1000;
}

export function boothStatus(f: StatusFacts, offlineAfterSeconds: number, now = new Date()): BoothStatus {
  if (f.state === "REVOKED") return "REVOKED";
  if (!f.hasDevice) return "UNREGISTERED";
  if (!f.lastHeartbeatAt) return "READY";
  if (!isOnline(f.lastHeartbeatAt, offlineAfterSeconds, now)) return "OFFLINE";
  if (f.lastError) return "ERROR";
  return f.hasLiveEvent ? "ACTIVE" : "ONLINE";
}

/** A station that hasn't asked for work for this long is not picked for prints. */
export const STATION_READY_SECONDS = 10;
export const stationOnline = (s: { lastPollAt: Date | null }, now = Date.now()) => !!s.lastPollAt && now - s.lastPollAt.getTime() <= STATION_READY_SECONDS * 1000;
