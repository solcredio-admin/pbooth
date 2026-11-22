// The built-in event template: where photos and the footer sit on the printed page.
// Sizes are pixels at 300 dpi, so the result is print-ready:
//   strip  2x6 in  = 600 x 1800   (classic photo-booth strip, 1-4 photos stacked)
//   grid   4x6 in  = 1200 x 1800  (2x2, or a wide photo over two for 3 shots)
//   single 4x6 in  = 1200 x 1800 portrait / 1800 x 1200 landscape (one framed photo)
export type Layout = "strip" | "grid";
export interface Rect { x: number; y: number; w: number; h: number }
export interface Plan { width: number; height: number; slots: Rect[]; footer: Rect; inset: number }

export function plan(layout: Layout, shots: number, orientation: "landscape" | "portrait"): Plan {
  const n = Math.max(1, Math.min(4, Math.round(shots)));
  if (n === 1) {
    const [width, height] = orientation === "portrait" ? [1200, 1800] : [1800, 1200];
    const m = 70, footerH = 230;
    return { width, height, inset: 22, slots: [{ x: m, y: m, w: width - 2 * m, h: height - 2 * m - footerH }], footer: { x: m, y: height - m - footerH, w: width - 2 * m, h: footerH } };
  }
  if (layout === "strip") {
    const width = 600, height = 1800, m = 40, gap = 22, footerH = 290;
    const h = Math.floor((height - m - footerH - gap * (n - 1)) / n);
    const slots = Array.from({ length: n }, (_, i) => ({ x: m, y: m + i * (h + gap), w: width - 2 * m, h }));
    return { width, height, inset: 16, slots, footer: { x: m, y: height - footerH, w: width - 2 * m, h: footerH - m / 2 } };
  }
  const width = 1200, height = 1800, m = 64, gap = 28, footerH = 300;
  const areaH = height - m - footerH;
  const colW = Math.floor((width - 2 * m - gap) / 2);
  const rowH = Math.floor((areaH - gap) / 2);
  const full = width - 2 * m;
  const slots: Rect[] =
    n === 2 ? [{ x: m, y: m, w: full, h: rowH }, { x: m, y: m + rowH + gap, w: full, h: rowH }]
    : n === 3 ? [{ x: m, y: m, w: full, h: rowH }, { x: m, y: m + rowH + gap, w: colW, h: rowH }, { x: m + colW + gap, y: m + rowH + gap, w: colW, h: rowH }]
    : [0, 1, 2, 3].map((i) => ({ x: m + (i % 2) * (colW + gap), y: m + Math.floor(i / 2) * (rowH + gap), w: colW, h: rowH }));
  return { width, height, inset: 24, slots, footer: { x: m, y: height - footerH, w: full, h: footerH - m / 2 } };
}
