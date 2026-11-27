"use client";
import { plan, type Layout } from "./layout";

/** Every layout a frame can be made for (a strip needs at least 2 photos). */
export const FRAME_LAYOUTS: { layout: Layout; shots: number; name: string }[] = [
  ...[1, 2, 3, 4].map((shots) => ({ layout: "landscape" as const, shots, name: "4R landscape" })),
  ...[2, 3, 4].map((shots) => ({ layout: "strip" as const, shots, name: "2×6 strip" })),
  ...[1, 2, 3, 4].map((shots) => ({ layout: "grid" as const, shots, name: "4R portrait" })),
];
export const frameKey = (layout: string, shots: number) => `${layout}-${shots}`;
export const framePlan = (layout: Layout, shots: number) => plan(layout, shots, layout === "landscape" ? "landscape" : "portrait");

/**
 * A starting file for a frame: the page at print size (300 dpi), see-through where each photo goes,
 * the photo spots outlined, and a dashed safe line (borderless printing trims a little off every edge).
 */
export function frameTemplate(layout: Layout, shots: number, name: string) {
  const p = framePlan(layout, shots);
  const c = document.createElement("canvas");
  c.width = p.width; c.height = p.height;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f1efe9";
  g.fillRect(0, 0, p.width, p.height);
  const safe = Math.round(Math.min(p.width, p.height) * 0.03);
  g.setLineDash([18, 12]);
  g.lineWidth = 3;
  g.strokeStyle = "#c2bfb6";
  g.strokeRect(safe, safe, p.width - 2 * safe, p.height - 2 * safe);
  g.setLineDash([]);
  p.slots.forEach((s, i) => {
    g.clearRect(s.x, s.y, s.w, s.h); // the photo shows through here
    g.lineWidth = 4;
    g.strokeStyle = "#e0217a";
    g.strokeRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
    g.fillStyle = "#e0217a";
    g.font = `600 ${Math.round(Math.min(p.width, p.height) * 0.028)}px ui-monospace, monospace`;
    g.textBaseline = "bottom";
    g.fillText(`PHOTO ${i + 1}`, s.x, s.y - 8);
  });
  const f = p.footer, size = Math.max(16, Math.round(Math.min(f.w / 26, f.h / 6)));
  g.fillStyle = "#77746c";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `500 ${size}px ui-monospace, monospace`;
  const lines = [`pbooth frame template · ${name}, ${shots} photo${shots === 1 ? "" : "s"}`, `${p.width} × ${p.height} px at 300 dpi · see-through = photos · keep text inside the dashed line`];
  lines.forEach((l, i) => g.fillText(l, f.x + f.w / 2, f.y + f.h / 2 + (i - 0.5) * size * 1.6, f.w));
  return c;
}

export function downloadTemplate(layout: Layout, shots: number, name: string) {
  frameTemplate(layout, shots, name).toBlob((b) => {
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `pbooth-frame-${layout}-${shots}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}
