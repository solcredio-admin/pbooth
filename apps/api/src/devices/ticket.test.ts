import { describe, expect, it } from "vitest";
import { newLocalSecret, signTicket, verifyTicket } from "./ticket.js";

describe("kiosk→agent pairing tickets", () => {
  const secret = newLocalSecret();
  it("verifies for the right booth and secret, within 5 minutes", () => {
    const { ticket } = signTicket("booth-1", secret);
    expect(verifyTicket(ticket, "booth-1", secret)).toBe(true);
    expect(verifyTicket(ticket, "booth-2", secret)).toBe(false);
    expect(verifyTicket(ticket, "booth-1", newLocalSecret())).toBe(false);
    expect(verifyTicket(ticket, "booth-1", secret, Date.now() + 301_000)).toBe(false);
  });
  it("rejects tampering and junk", () => {
    const { ticket } = signTicket("booth-1", secret);
    const [p, s] = ticket.split(".");
    const forged = Buffer.from(JSON.stringify({ boothId: "booth-1", exp: 9e9, nonce: "x" })).toString("base64url");
    expect(verifyTicket(`${forged}.${s}`, "booth-1", secret)).toBe(false);
    expect(verifyTicket(`${p}.`, "booth-1", secret)).toBe(false);
    expect(verifyTicket("nonsense", "booth-1", secret)).toBe(false);
  });
});
