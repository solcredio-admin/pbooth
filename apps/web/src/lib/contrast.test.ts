import { describe, expect, it } from "vitest";
import { buttonOn, contrast, inkOn } from "./contrast";
import { commonAspect } from "./aspect";

describe("gallery buttons always read", () => {
  it("for any pair of event colours", () => {
    const set = ["#000000", "#0b0c0a", "#141414", "#1b1730", "#7a1f2b", "#808080", "#c6f36b", "#f3e3d3", "#ffd700", "#ffffff", "#ff0000", "#0000ff"];
    for (const bg of set) for (const accent of set) {
      const b = buttonOn(bg, accent);
      expect(contrast(b.ink, b.fill), `label ${bg} ${accent}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(b.fill, bg), `button ${bg} ${accent}`).toBeGreaterThanOrEqual(3);
      expect(contrast(inkOn(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("tiles take the photos' usual shape", () => {
    expect(commonAspect([{ width: 600, height: 1800 }, { width: 600, height: 1800 }, { width: 1800, height: 1200 }])).toBeCloseTo(1 / 3, 1);
    expect(commonAspect([{ width: null, height: null }])).toBe(1.5);
  });
});
