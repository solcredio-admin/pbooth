"use client";
import { logoBox, plan, printSheet, type Layout, type LogoPosition, type Rect } from "./layout";

export type Pattern = "none" | "dots" | "stripes" | "grid" | "confetti" | "waves" | "gradient";
export type FrameStyle = "line" | "double" | "corners" | "none";
export type PhotoStyle = "rounded" | "square" | "white";
export type FontStyle = "serif" | "sans" | "mono";

export interface Logo { src: string; position: LogoPosition; size: number }

export interface TemplateInput {
  layout: Layout;
  orientation: "landscape" | "portrait";
  primaryColor: string; // page / border colour
  accentColor: string;  // frame line, pattern and footer title
  footer: string;       // event name or custom text
  dateText: string | null;
  logo?: Logo | null;   // takes the date's place
  pattern?: Pattern;
  frameStyle?: FrameStyle;
  photoStyle?: PhotoStyle;
  fontStyle?: FontStyle;
}

const FONTS: Record<FontStyle, { family: string; weight: number }> = {
  serif: { family: '"Cormorant Garamond Variable", "Cormorant Garamond", Georgia, serif', weight: 300 },
  sans: { family: 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif', weight: 600 },
  mono: { family: '"Roboto Mono Variable", "Roboto Mono", ui-monospace, monospace', weight: 500 },
};
const MONO = FONTS.mono.family;

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
  const unit = Math.min(p.width, p.height);

  g.fillStyle = t.primaryColor;
  g.fillRect(0, 0, p.width, p.height);
  drawPattern(g, t.pattern ?? "none", p.width, p.height, t.primaryColor, t.accentColor, ink);
  drawFrame(g, t.frameStyle ?? "line", p, t.accentColor);

  photos.forEach((img, i) => drawPhoto(g, img, p.slots[i], t.photoStyle ?? "rounded", unit));

  // footer: on a patterned page it sits on a calm band of the page colour so it stays readable
  const f = p.footer;
  if ((t.pattern ?? "none") !== "none" && t.pattern !== "gradient") {
    g.save();
    g.globalAlpha = 0.92;
    g.fillStyle = t.primaryColor;
    g.beginPath();
    g.roundRect(f.x, f.y + f.h * 0.06, f.w, f.h * 0.88, unit * 0.02);
    g.fill();
    g.restore();
  }
  const logo = t.logo ? await loadImage(t.logo.src) : null; // unreadable: the plain footer still prints
  const box = logo && t.logo ? logoBox(p, logo.naturalWidth / logo.naturalHeight, t.logo.size, t.logo.position) : null;
  if (logo && box) g.drawImage(logo, box.x, box.y, box.w, box.h); // after the photos, so it can overlap them
  // the name goes beside a left or right logo if there's room; a centred logo stands alone
  const nameW = !box ? f.w : t.logo!.position === "center" ? 0 : f.w - box.w;
  if (nameW < f.w * 0.25) return canvas;
  const nameX = box && t.logo!.position === "left" ? f.x + f.w - nameW : f.x;
  const dateText = box ? null : t.dateText;

  const font = FONTS[t.fontStyle ?? "serif"];
  await document.fonts?.load(`${font.weight} 80px ${font.family}`).catch(() => undefined);
  const cx = nameX + nameW / 2;
  let size = Math.round(f.h * (t.fontStyle === "serif" || !t.fontStyle ? 0.34 : 0.26));
  const setFont = () => { g.font = `${font.weight} ${size}px ${font.family}`; };
  setFont();
  while (size > 18 && g.measureText(t.footer).width > nameW * 0.9) { size -= 2; setFont(); }
  g.fillStyle = t.accentColor;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const titleY = f.y + f.h * (dateText ? 0.4 : 0.5);
  g.fillText(t.footer, cx, titleY, nameW * 0.9);
  if (dateText) {
    g.fillRect(cx - f.w * 0.06, titleY + size * 0.62, f.w * 0.12, Math.max(2, p.width / 600));
    g.font = `500 ${Math.round(f.h * 0.085)}px ${MONO}`;
    g.fillStyle = ink;
    g.globalAlpha = 0.75;
    g.fillText(dateText.toUpperCase(), cx, titleY + size * 0.62 + f.h * 0.16);
    g.globalAlpha = 1;
  }
  return canvas;
}

/** The 4x6 sheet sent to the printer: the design itself, or a strip twice with cut marks between. */
export function printCanvas(design: HTMLCanvasElement, layout: Layout, shots: number): HTMLCanvasElement {
  const sheet = printSheet(layout, shots);
  if (!sheet) return design;
  const c = document.createElement("canvas");
  c.width = sheet.width;
  c.height = sheet.height;
  const g = c.getContext("2d")!;
  for (let i = 0; i < sheet.copies; i++) g.drawImage(design, i * design.width, 0, design.width, sheet.height);
  // short cut guides at the top and bottom edge only, so nothing marks the photos
  g.fillStyle = "rgba(128,128,128,.8)";
  for (let i = 1; i < sheet.copies; i++) {
    const x = i * design.width - 1;
    g.fillRect(x, 0, 2, 36);
    g.fillRect(x, sheet.height - 36, 2, 36);
  }
  return c;
}

export const toJpeg = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), "image/jpeg", 0.92));

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img.naturalWidth ? img : null);
  img.onerror = () => resolve(null);
  img.src = src;
});

function drawPhoto(g: CanvasRenderingContext2D, img: CanvasImageSource, slot: Rect, style: PhotoStyle, unit: number) {
  let r = slot;
  if (style === "white") {
    // a white mat around each photo, with a soft shadow
    g.save();
    g.shadowColor = "rgba(0,0,0,.25)";
    g.shadowBlur = unit * 0.015;
    g.shadowOffsetY = unit * 0.004;
    g.fillStyle = "#fbfaf6";
    g.fillRect(slot.x, slot.y, slot.w, slot.h);
    g.restore();
    const mat = Math.round(unit * 0.018);
    r = { x: slot.x + mat, y: slot.y + mat, w: slot.w - 2 * mat, h: slot.h - 2 * mat };
  }
  const iw = (img as { width: number }).width, ih = (img as { height: number }).height;
  const scale = Math.max(r.w / iw, r.h / ih);
  const sw = r.w / scale, sh = r.h / scale;
  g.save();
  g.beginPath();
  g.roundRect(r.x, r.y, r.w, r.h, style === "rounded" ? Math.min(r.w, r.h) * 0.03 : 0);
  g.clip();
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
  g.restore();
}

function drawFrame(g: CanvasRenderingContext2D, style: FrameStyle, p: { width: number; height: number; inset: number }, accent: string) {
  if (style === "none") return;
  const lw = Math.max(3, p.width / 300);
  g.strokeStyle = accent;
  g.lineWidth = lw;
  const box = (i: number) => g.strokeRect(i, i, p.width - 2 * i, p.height - 2 * i);
  if (style === "line") box(p.inset);
  if (style === "double") { box(p.inset * 0.6); g.lineWidth = lw / 2; box(p.inset * 0.6 + lw * 2.5); }
  if (style === "corners") {
    const i = p.inset, len = Math.min(p.width, p.height) * 0.08;
    g.lineWidth = lw * 1.4;
    g.beginPath();
    for (const [x, y, dx, dy] of [[i, i, 1, 1], [p.width - i, i, -1, 1], [i, p.height - i, 1, -1], [p.width - i, p.height - i, -1, -1]]) {
      g.moveTo(x + dx * len, y); g.lineTo(x, y); g.lineTo(x, y + dy * len);
    }
    g.stroke();
  }
}

function drawPattern(g: CanvasRenderingContext2D, pattern: Pattern, w: number, h: number, primary: string, accent: string, ink: string) {
  if (pattern === "none") return;
  const s = Math.min(w, h) / 22; // pattern scale follows the page
  g.save();
  if (pattern === "gradient") {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, primary);
    grd.addColorStop(1, mix(primary, accent, 0.45));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  } else if (pattern === "dots") {
    g.fillStyle = accent; g.globalAlpha = 0.22;
    for (let y = s / 2, row = 0; y < h; y += s, row++) for (let x = (row % 2) * s / 2; x < w + s; x += s) { g.beginPath(); g.arc(x, y, s * 0.12, 0, Math.PI * 2); g.fill(); }
  } else if (pattern === "stripes") {
    g.strokeStyle = accent; g.globalAlpha = 0.16; g.lineWidth = s * 0.28;
    g.beginPath();
    for (let x = -h; x < w; x += s * 0.9) { g.moveTo(x, h); g.lineTo(x + h, 0); }
    g.stroke();
  } else if (pattern === "grid") {
    g.strokeStyle = accent; g.globalAlpha = 0.18; g.lineWidth = Math.max(1.5, s * 0.04);
    g.beginPath();
    for (let x = 0; x <= w; x += s) { g.moveTo(x, 0); g.lineTo(x, h); }
    for (let y = 0; y <= h; y += s) { g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
  } else if (pattern === "waves") {
    g.strokeStyle = accent; g.globalAlpha = 0.2; g.lineWidth = Math.max(2, s * 0.08);
    for (let y = 0; y < h + s; y += s * 0.7) {
      g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x / (s * 0.9)) * s * 0.18);
      g.stroke();
    }
  } else if (pattern === "confetti") {
    // same confetti every time (seeded), so the preview matches the print
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const colors = [accent, ink, mix(accent, ink, 0.5)];
    const count = Math.round((w * h) / (s * s) * 0.9);
    for (let k = 0; k < count; k++) {
      g.save();
      g.translate(rnd() * w, rnd() * h);
      g.rotate(rnd() * Math.PI);
      g.globalAlpha = 0.28 + rnd() * 0.3;
      g.fillStyle = colors[k % colors.length];
      if (k % 3 === 0) { g.beginPath(); g.arc(0, 0, s * 0.11, 0, Math.PI * 2); g.fill(); }
      else g.fillRect(-s * 0.16, -s * 0.05, s * 0.32, s * 0.1);
      g.restore();
    }
  }
  g.restore();
}

/** Blend two #rrggbb colours (t = 0 → a, 1 → b). */
function mix(a: string, b: string, t: number) {
  const c = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t).toString(16).padStart(2, "0")).join("");
}
