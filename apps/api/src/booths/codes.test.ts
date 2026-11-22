import { describe, expect, it } from "vitest";
import { newBoothCode, newDeviceToken, newEnrollmentCode, normalizeEnrollmentCode } from "./codes.js";

describe("booth codes", () => {
  it("have the documented shapes", () => {
    expect(newBoothCode()).toMatch(/^PB-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(newEnrollmentCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(newDeviceToken()).toMatch(/^pbd_[A-Za-z0-9_-]{43}$/);
  });

  it("normalizes what people type", () => {
    expect(normalizeEnrollmentCode(" 7k3m-q9tx ")).toBe("7K3MQ9TX");
    expect(normalizeEnrollmentCode("O1IL")).toBe("0111");
    const code = newEnrollmentCode();
    expect(normalizeEnrollmentCode(code.toLowerCase())).toBe(normalizeEnrollmentCode(code));
  });
});
