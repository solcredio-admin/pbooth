import type { NextConfig } from "next";
import path from "node:path";

// The API runs next to Next.js (same container) and is reached through this rewrite,
// so the browser only ever talks to one origin: cookies stay first-party, no CORS.
const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  // Socket.IO's path ends in "/" (/socket.io/?EIO=4…); don't let Next redirect it away.
  skipTrailingSlashRedirect: true,
  // Event ZIP exports stream for minutes; the rewrite proxy's default 30 s would cut them off.
  experimental: { proxyTimeout: 15 * 60_000 },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      // Live updates. Long-polling always works through this rewrite; Socket.IO upgrades to a
      // WebSocket when the proxy in front allows it.
      { source: "/socket.io/:path*", destination: `${api}/socket.io/:path*` },
    ];
  },
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    ];
    return [
      { source: "/:path*", headers: security },
      // Logos/icons change only with a release; ?v= in their URLs busts the cache.
      { source: "/:file(logo-.*|favicon.*|apple-touch-icon.png)", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default config;
