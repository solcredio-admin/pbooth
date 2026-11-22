import { describe, expect, it } from "vitest";
import { plan, printSheet, type Rect } from "./layout";

const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("event template layout", () => {
  for (const layout of ["landscape", "strip", "grid"] as const) {
    for (const shots of [1, 2, 3, 4]) {
      it(`${layout} with ${shots} shot(s): one slot per photo, all on the page, none overlapping`, () => {
        const p = plan(layout, shots, "landscape");
        expect(p.slots).toHaveLength(shots);
        for (const s of [...p.slots, p.footer]) expect(inside(s, p.width, p.height)).toBe(true);
        const all = [...p.slots, p.footer];
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
      });
    }
  }

  it("prints on 4R: landscape is 6x4 in, a strip goes twice on a 4x6 sheet", () => {
    for (const n of [1, 2, 3, 4]) expect([plan("landscape", n).width, plan("landscape", n).height]).toEqual([1800, 1200]);
    expect(printSheet("strip", 4)).toEqual({ width: 1200, height: 1800, copies: 2 });
    expect(printSheet("strip", 4)!.width).toBe(plan("strip", 4).width * 2);
    expect(printSheet("landscape", 4)).toBeNull();
    expect(printSheet("grid", 4)).toBeNull();
  });

  it("uses real print sizes at 300 dpi", () => {
    expect([plan("strip", 4, "landscape").width, plan("strip", 4, "landscape").height]).toEqual([600, 1800]);
    expect([plan("grid", 4, "landscape").width, plan("grid", 4, "landscape").height]).toEqual([1200, 1800]);
    expect([plan("grid", 1, "portrait").width, plan("grid", 1, "portrait").height]).toEqual([1200, 1800]);
    expect([plan("grid", 1, "landscape").width, plan("grid", 1, "landscape").height]).toEqual([1800, 1200]);
  });
});
