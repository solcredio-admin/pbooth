import { NextResponse, type NextRequest } from "next/server";

// Runs before every page: sets a per-request CSP nonce, and sends signed-out visitors to /login.
// (The cookie is only checked for presence here; the admin layout verifies it with the API.)
const isPublic = (path: string) => path === "/login" || path.startsWith("/kiosk/"); // kiosks use their own paired cookie
// Paper Shaders' style slot is pre-created empty; this is the hash of the empty string.
const EMPTY_STYLE = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!isPublic(pathname) && !req.cookies.has("pb_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const https = req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}' ${EMPTY_STYLE}${dev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob: mediastream:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [{
    source: "/((?!api|socket\\.io|_next/static|_next/image|favicon|apple-touch-icon|logo|theme\\.js).*)",
    missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }],
  }],
};
