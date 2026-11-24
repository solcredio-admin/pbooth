// The design choices, shared by the event settings and the self-service kiosk (where guests pick them).
import type { FontStyle, FrameStyle, Pattern, PhotoStyle } from "./compose";

// One-tap colour pairs for the design (page colour, accent).
export const PALETTES = [
  { name: "Midnight lime", primaryColor: "#0b0c0a", accentColor: "#c6f36b" },
  { name: "Classic white", primaryColor: "#f7f4ec", accentColor: "#1b1b1b" },
  { name: "Blush", primaryColor: "#f6dfe0", accentColor: "#b4475a" },
  { name: "Navy & gold", primaryColor: "#14213d", accentColor: "#e9c46a" },
  { name: "Sage", primaryColor: "#dfe7d6", accentColor: "#3f5f45" },
  { name: "Terracotta", primaryColor: "#f3e3d3", accentColor: "#c0593b" },
  { name: "Lavender", primaryColor: "#e7e1f5", accentColor: "#5b4b9a" },
  { name: "Black & white", primaryColor: "#111111", accentColor: "#f5f5f5" },
];
export const STYLE_OPTIONS = {
  pattern: [["none", "Plain"], ["gradient", "Gradient"], ["dots", "Dots"], ["stripes", "Stripes"], ["grid", "Grid"], ["waves", "Waves"], ["confetti", "Confetti"]],
  frameStyle: [["line", "Thin line"], ["double", "Double line"], ["corners", "Corner marks"], ["none", "No frame"]],
  photoStyle: [["rounded", "Rounded"], ["square", "Square"], ["white", "White border"]],
  fontStyle: [["serif", "Elegant serif"], ["sans", "Bold sans"], ["mono", "Typewriter"]],
} as const;
export type StyleKey = keyof typeof STYLE_OPTIONS;
export const STYLE_LABEL: Record<StyleKey, string> = { pattern: "Background", frameStyle: "Frame", photoStyle: "Photo edges", fontStyle: "Footer type" };

/** Everything a guest can change about their print's design. */
export interface Look { primaryColor: string; accentColor: string; pattern: Pattern; frameStyle: FrameStyle; photoStyle: PhotoStyle; fontStyle: FontStyle }
