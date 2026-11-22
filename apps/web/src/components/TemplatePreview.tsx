"use client";
import { useEffect, useState } from "react";
import { composeTemplate } from "@/lib/template/compose";
import type { Layout } from "@/lib/template/layout";

export interface PreviewProps { layout: Layout; shots: number; primaryColor: string; accentColor: string; footer: string; dateText: string | null }

// Stand-in "photos": soft gradients with a figure, so the preview shows the design, not a stock image.
function placeholder(i: number) {
  const c = document.createElement("canvas");
  c.width = 960; c.height = 640;
  const g = c.getContext("2d")!;
  const hue = [205, 330, 40, 150][i % 4];
  const grd = g.createLinearGradient(0, 0, 960, 640);
  grd.addColorStop(0, `hsl(${hue} 45% 72%)`);
  grd.addColorStop(1, `hsl(${(hue + 40) % 360} 40% 48%)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 960, 640);
  g.fillStyle = "rgba(255,255,255,.55)";
  g.beginPath(); g.arc(480, 270, 92, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(480, 610, 220, 230, 0, Math.PI, 0); g.fill();
  return c;
}

/** The event's photo design, drawn with the same code the kiosk uses. */
export function TemplatePreview(p: PreviewProps) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const canvas = await composeTemplate(Array.from({ length: p.shots }, (_, i) => placeholder(i)), { ...p, orientation: "landscape" });
      if (alive) setSrc(canvas.toDataURL("image/jpeg", 0.85));
    }, 120); // redraw once typing pauses
    return () => { alive = false; clearTimeout(t); };
  }, [p.layout, p.shots, p.primaryColor, p.accentColor, p.footer, p.dateText]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <figure className="template-preview">
      {src ? <img src={src} alt="Preview of the event's photo design" /> : <div className="skeleton" />}
      <figcaption className="cap">{p.shots === 1 ? "4×6 framed photo" : p.layout === "strip" ? "2×6 photo strip" : "4×6 grid"} · placeholder photos</figcaption>
    </figure>
  );
}
