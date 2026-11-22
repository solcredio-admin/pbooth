import "./kiosk.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Kiosk" };
// Kiosks are touch screens: no pinch-zoom, no accidental double-tap zoom.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function KioskLayout({ children }: { children: ReactNode }) {
  return children;
}
