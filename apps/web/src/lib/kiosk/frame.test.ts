import { describe, expect, it } from "vitest";
import { boothAspect, frameSize } from "./frame";

describe("booth photo framing", () => {
  it("keeps a 16:9 camera as is on a landscape booth", () => {
    expect(frameSize(1920, 1080, 0, boothAspect(false))).toEqual({ width: 1920, height: 1080 });
  });
  it("crops a 4:3 webcam to 16:9 (full width)", () => {
    expect(frameSize(1600, 1200, 0, boothAspect(false))).toEqual({ width: 1600, height: 900 });
  });
  it("a sideways camera on a portrait booth fills 9:16 without cropping", () => {
    expect(frameSize(1920, 1080, 90, boothAspect(true))).toEqual({ width: 1080, height: 1920 });
    expect(frameSize(1920, 1080, 270, boothAspect(true))).toEqual({ width: 1080, height: 1920 });
  });
  it("an upright camera on a portrait booth is cropped to a 9:16 centre", () => {
    expect(frameSize(1920, 1080, 0, boothAspect(true))).toEqual({ width: 608, height: 1080 });
  });
});
