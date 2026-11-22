import { createHmac, timingSafeEqual } from "node:crypto";

// Same format as apps/api/src/devices/ticket.ts: "<base64url payload>.<base64url HMAC-SHA256>".
export function verifyTicket(ticket: string, boothId: string, secret: string, now = Date.now()): boolean {
  const [payload, sig] = String(ticket).split(".");
  if (!payload || !sig) return false;
  const want = createHmac("sha256", secret).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return body.boothId === boothId && typeof body.exp === "number" && body.exp * 1000 > now;
  } catch {
    return false;
  }
}
