import "@fontsource-variable/cormorant-garamond";
import "@fontsource-variable/roboto-mono";
import "./glass.css";
import "./admin.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { V } from "@/lib/v";

export const metadata: Metadata = {
  title: { default: "pbooth", template: "%s · pbooth" },
  description: "Photobooth event management",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: `/favicon.png?v=${V}`, media: "(prefers-color-scheme: light)" },
      { url: `/favicon-dark.png?v=${V}`, media: "(prefers-color-scheme: dark)" },
    ],
    apple: `/apple-touch-icon.png?v=${V}`,
  },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading headers makes every page render per request, which the CSP nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // theme.js sets data-theme and the intro flag before React hydrates, hence the warning opt-out.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src={`/theme.js?v=${V}`} nonce={nonce} />
      </head>
      <body>{children}</body>
    </html>
  );
}
