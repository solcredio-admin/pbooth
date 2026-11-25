// Readable colours out of an event's own two (WCAG contrast).
const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
export const DARK = "#0b0c0a", LIGHT = "#f6f5f0";
/** Black or white, whichever reads better on this colour. */
export const inkOn = (bg: string) => (contrast(DARK, bg) >= contrast(LIGHT, bg) ? DARK : LIGHT);
/** A button on this page: the accent if it stands out from the page, else the page's ink colour. */
export function buttonOn(bg: string, accent: string) {
  const fill = contrast(accent, bg) >= 3 ? accent : inkOn(bg);
  return { fill, ink: inkOn(fill) };
}
