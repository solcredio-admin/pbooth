import { describe, expect, it } from "vitest";
import { eventWindow, isValidTimeZone, utcToWallTime, wallTimeToUtc } from "./tz.js";

describe("time zones", () => {
  it("converts venue wall time to UTC (winter and summer)", () => {
    expect(wallTimeToUtc("2026-12-05", "18:30", "America/Los_Angeles").toISOString()).toBe("2026-12-06T02:30:00.000Z");
    expect(wallTimeToUtc("2026-07-05", "18:30", "America/Los_Angeles").toISOString()).toBe("2026-07-06T01:30:00.000Z");
    expect(wallTimeToUtc("2026-07-05", "18:30", "Asia/Manila").toISOString()).toBe("2026-07-05T10:30:00.000Z");
  });

  it("handles the DST change day", () => {
    // US clocks fall back on 2026-11-01: 01:30 happens twice, 03:00 is unambiguous.
    expect(wallTimeToUtc("2026-11-01", "03:00", "America/New_York").toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(wallTimeToUtc("2026-03-08", "03:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("round-trips back to the wall clock", () => {
    const at = wallTimeToUtc("2026-12-31", "23:15", "Europe/London");
    expect(utcToWallTime(at, "Europe/London")).toEqual({ date: "2026-12-31", time: "23:15" });
  });

  it("rolls the end past midnight", () => {
    const w = eventWindow("2026-12-31", "20:00", "01:00", "UTC");
    expect(w.endsAt.toISOString()).toBe("2027-01-01T01:00:00.000Z");
    expect(eventWindow("2026-12-31", "20:00", "23:00", "UTC").endsAt.toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("validates IANA zones", () => {
    expect(isValidTimeZone("Asia/Manila")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
