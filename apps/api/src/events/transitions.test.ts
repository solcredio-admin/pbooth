import { describe, expect, it } from "vitest";
import { allowedTransitions, canTransition } from "./transitions.js";

describe("event status transitions", () => {
  it("follows the event lifecycle", () => {
    expect(allowedTransitions("DRAFT")).toEqual(["schedule", "activate", "archive"]);
    expect(allowedTransitions("SCHEDULED")).toEqual(["activate", "archive"]);
    expect(allowedTransitions("ACTIVE")).toEqual(["complete"]);
    expect(allowedTransitions("COMPLETED")).toEqual(["activate", "archive"]);
    expect(allowedTransitions("ARCHIVED")).toEqual([]);
  });

  it("never archives a live event or completes one that isn't running", () => {
    expect(canTransition("ACTIVE", "archive")).toBe(false);
    expect(canTransition("DRAFT", "complete")).toBe(false);
    expect(canTransition("ARCHIVED", "activate")).toBe(false);
  });
});
