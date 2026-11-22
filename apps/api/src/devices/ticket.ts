import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Kiosk → agent pairing ticket: "<payload>.<signature>", both base64url.
// payload = { boothId, exp (unix seconds), nonce }. Signed with the booth device's localSecret,
// which only the cloud and that agent know. The agent checks it offline.
// (apps/agent/src/local/ticket.ts verifies the same format; keep the two in step.)
export const TICKET_SECONDS = 300;

export const newLocalSecret = () => randomBytes(32).toString("base64url");

export function signTicket(boothId: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ boothId, exp: Math.floor(now / 1000) + TICKET_SECONDS, nonce: randomBytes(9).toString("base64url") })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return { ticket: `${payload}.${sig}`, expiresInSeconds: TICKET_SECONDS };
}

export function verifyTicket(ticket: string, boothId: string, secret: string, now = Date.now()): boolean {
  const [payload, sig] = ticket.split(".");
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
