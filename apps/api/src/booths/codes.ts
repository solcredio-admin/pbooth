import { randomBytes, randomInt } from "node:crypto";

// Crockford-style alphabet: no I, L, O or U, so codes read cleanly off a screen or over the phone.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** Booth code, e.g. "PB-7K3M". Public-ish (it will appear in kiosk URLs), so not a secret. */
export const newBoothCode = () => `PB-${pick(4)}`;

/** One-time enrollment code shown to the admin, e.g. "7K3M-Q9TX" (40 bits, expires, single use). */
export const newEnrollmentCode = () => `${pick(4)}-${pick(4)}`;

/** What the person typed → canonical form: case, dashes, spaces and look-alikes don't matter. */
export const normalizeEnrollmentCode = (input: string) =>
  input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

/** The device's long-lived credential (stored hashed). The prefix makes leaks easy to spot. */
export const newDeviceToken = () => `pbd_${randomBytes(32).toString("base64url")}`;
