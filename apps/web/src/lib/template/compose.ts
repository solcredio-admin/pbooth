"use client";
import { plan, type Layout, type Rect } from "./layout";

export interface TemplateInput {
  layout: Layout;
  orientation: "landscape" | "portrait";
  primaryColor: string; // page / border colour
  accentColor: string;  // frame line and footer title
  footer: string;       // event name or custom text
  dateText: string | null;
}

const SERIF = '"Cormorant Garamond Variable", "Cormorant Garamond", Georgia, serif';
const MONO = '"Roboto Mono Variable", "Roboto Mono", ui-monospace, monospace';

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Draws photos into the event template. Photos are cropped to fill their slot (centre crop). */
export async function composeTemplate(photos: CanvasImageSource[], t: TemplateInput): Promise<HTMLCanvasElement> {
  const p = plan(t.layout, photos.length, t.orientation);
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  const g = canvas.getContext("2d")!;
  const ink = luminance(t.primaryColor) > 0.55 ? "#141414" : "#f6f5f0";

  // page and a thin inset frame in the accent colour
  g.fillStyle = t.primaryColor;
  g.fillRect(0, 0, p.width, p.height);
  g.strokeStyle = t.accentColor;
  g.lineWidth = Math.max(3, p.width / 300);
  g.strokeRect(p.inset, p.inset, p.width - 2 * p.inset, p.height - 2 * p.inset);

  photos.forEach((img, i) => drawCover(g, img, p.slots[i]));

  // footer: title (fitted to the width), a short accent rule, the date
  await document.fonts?.load(`300 80px ${SERIF}`).catch(() => undefined);
  const f = p.footer;
  const cx = f.x + f.w / 2;
  let size = Math.round(f.h * 0.34);
  g.font = `300 ${size}px ${SERIF}`;
  while (size > 18 && g.measureText(t.footer).width > f.w * 0.92) { size -= 2; g.font = `300 ${size}px ${SERIF}`; }
  g.fillStyle = t.accentColor;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const titleY = f.y + f.h * (t.dateText ? 0.4 : 0.5);
  g.fillText(t.footer, cx, titleY, f.w * 0.92);
  if (t.dateText) {
    g.fillRect(cx - f.w * 0.06, titleY + size * 0.62, f.w * 0.12, Math.max(2, p.width / 600));
    g.font = `500 ${Math.round(f.h * 0.085)}px ${MONO}`;
    g.fillStyle = ink;
    g.globalAlpha = 0.75;
    g.fillText(t.dateText.toUpperCase(), cx, titleY + size * 0.62 + f.h * 0.16);
    g.globalAlpha = 1;
  }
  return canvas;
}

export const toJpeg = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), "image/jpeg", 0.92));

function drawCover(g: CanvasRenderingContext2D, img: CanvasImageSource, r: Rect) {
  const iw = (img as { width: number }).width, ih = (img as { height: number }).height;
  const scale = Math.max(r.w / iw, r.h / ih);
  const sw = r.w / scale, sh = r.h / scale;
  g.save();
  g.beginPath();
  g.roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.02);
  g.clip();
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
  g.restore();
}
