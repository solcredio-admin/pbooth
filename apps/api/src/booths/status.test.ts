import { describe, expect, it } from "vitest";
import { boothStatus, type StatusFacts } from "./status.js";

const now = new Date("2026-11-21T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);
const base: StatusFacts = { state: "READY", hasDevice: true, lastHeartbeatAt: ago(10), lastError: null, hasLiveEvent: false };
const status = (f: Partial<StatusFacts>) => boothStatus({ ...base, ...f }, 90, now);

describe("booth status", () => {
  it("derives every status from the facts", () => {
    expect(status({ state: "REVOKED" })).toBe("REVOKED");
    expect(status({ state: "UNREGISTERED", hasDevice: false })).toBe("UNREGISTERED");
    expect(status({ lastHeartbeatAt: null })).toBe("READY");
    expect(status({})).toBe("ONLINE");
    expect(status({ hasLiveEvent: true })).toBe("ACTIVE");
    expect(status({ lastError: "Camera not found" })).toBe("ERROR");
  });

  it("goes offline exactly after the window", () => {
    expect(status({ lastHeartbeatAt: ago(90) })).toBe("ONLINE");
    expect(status({ lastHeartbeatAt: ago(91), hasLiveEvent: true })).toBe("OFFLINE");
    expect(status({ lastHeartbeatAt: ago(500), lastError: "x" })).toBe("OFFLINE");
  });
});
