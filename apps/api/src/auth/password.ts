import argon2 from "argon2";

// argon2id is the current recommendation for password storage (OWASP).
// The library's defaults (64 MiB memory, 3 passes) make each guess slow on purpose.
export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw).catch(() => false);

export const MIN_PASSWORD_LENGTH = 12;
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (pw.length > 256) return "Password is too long";
  return null;
}

// Verified against when the username doesn't exist, so a wrong username takes as long as a wrong password.
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword("not-a-real-password-just-timing"));
