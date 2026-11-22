import { expect, inject } from "vitest";

export const base = inject("apiBase");
export const ORIGIN = "http://app.test";
export { ADMIN } from "./fixtures.js";
import { ADMIN } from "./fixtures.js";

export interface CallInit { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string; token?: string }

// Each test file passes its own fake client IP (the test server trusts one proxy hop),
// so per-IP rate limits in one file never spill into another.
export async function call(path: string, init: CallInit = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": init.ip ?? "10.0.0.1" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.origin !== null && !init.token) headers.origin = init.origin ?? ORIGIN;
  const res = await fetch(base + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") };
}

export async function login(ip?: string) {
  const r = await call("/auth/login", { method: "POST", body: ADMIN, ip });
  expect(r.status).toBe(200);
  return r.setCookie!.split(";")[0];
}

export const newEvent = {
  name: "Reyes Wedding", organizerName: "Ana Reyes", venueName: "Casa Loma",
  date: "2026-12-05", startTime: "18:00", endTime: "01:00", timeZone: "Asia/Manila",
};
