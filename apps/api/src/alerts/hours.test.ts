import { describe, expect, it } from "vitest";
import { withinHours } from "./hours.js";

describe("alert hours", () => {
  it("covers a day window, one past midnight, and no window", () => {
    expect(withinHours("09:00", "09:00", "18:00")).toBe(true);
    expect(withinHours("18:00", "09:00", "18:00")).toBe(false);
    expect(withinHours("23:30", "18:00", "02:00")).toBe(true);
    expect(withinHours("01:59", "18:00", "02:00")).toBe(true);
    expect(withinHours("12:00", "18:00", "02:00")).toBe(false);
    expect(withinHours("03:00", null, null)).toBe(true);
    expect(withinHours("03:00", "09:00", null)).toBe(true);
  });
});
