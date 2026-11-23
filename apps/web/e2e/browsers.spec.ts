import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, request, test, type APIRequestContext } from "@playwright/test";

// The pages people open on their own devices, in every engine: guests' QR galleries (iPhone Safari,
// Android Chrome) and the admin pages (Safari, Firefox, Chrome). The booth kiosk itself runs in
// Chrome on the booth computer and is covered by offline.spec.ts.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3399";
const ADMIN = { username: process.env.E2E_USERNAME ?? "admin@test.local", password: process.env.E2E_PASSWORD ?? "correct-horse-battery" };
const h = { origin: new URL(BASE).origin };
const design = readFileSync(new URL("./fixtures/design.jpg", import.meta.url));

let galleryToken = "";
let eventName = "";

// One live event with one finished guest (a processed design), made through the API.
// The admin session is shared across browsers: sign-in allows 10 attempts per 15 minutes per IP.
const AUTH = new URL("../test-results/.admin-session.json", import.meta.url).pathname;
async function adminContext() {
  if (existsSync(AUTH)) {
    const ctx = await request.newContext({ baseURL: BASE, storageState: AUTH });
    if ((await ctx.get("/api/v1/auth/me")).ok()) return ctx;
    await ctx.dispose();
  }
  const ctx = await request.newContext({ baseURL: BASE });
  expect((await ctx.post("/api/v1/auth/login", { data: ADMIN, headers: h })).ok()).toBe(true);
  mkdirSync(dirname(AUTH), { recursive: true });
  await ctx.storageState({ path: AUTH });
  return ctx;
}

test.beforeAll(async () => {
  const admin = await adminContext();
  eventName = `Browser check ${Date.now()}`;
  const booth = await (await admin.post("/api/v1/booths", { data: { name: `Browsers ${Date.now()}` }, headers: h })).json();
  const event = await (await admin.post("/api/v1/events", {
    data: { name: eventName, date: new Date().toISOString().slice(0, 10), startTime: "00:00", endTime: "23:59", timeZone: "UTC" }, headers: h,
  })).json();
  await admin.post(`/api/v1/events/${event.id}/booths`, { data: { boothId: booth.id }, headers: h });
  await admin.post(`/api/v1/events/${event.id}/activate`, { headers: h });
  const { code } = await (await admin.post(`/api/v1/booths/${booth.id}/kiosk-code`, { headers: h })).json();

  const kiosk: APIRequestContext = await request.newContext({ baseURL: BASE });
  expect((await kiosk.post("/api/v1/kiosk/pair", { data: { boothCode: booth.code, code }, headers: h })).ok()).toBe(true);
  const sessionId = randomUUID();
  galleryToken = randomBytes(32).toString("base64url");
  expect((await kiosk.post("/api/v1/sessions", { data: { id: sessionId, galleryToken }, headers: h })).ok()).toBe(true);
  const photoId = randomUUID();
  const auth = await (await kiosk.post("/api/v1/photos/upload-authorize", {
    data: { photoId, sessionId, kind: "DESIGN", index: 0, sha256: createHash("sha256").update(design).digest("hex"), size: design.length, contentType: "image/jpeg" }, headers: h,
  })).json();
  expect((await fetch(auth.url, { method: "PUT", body: design, headers: auth.headers })).ok).toBe(true);
  await kiosk.post("/api/v1/photos/upload-complete", { data: { photoId }, headers: h });
  await expect.poll(async () => (await (await admin.get(`/api/v1/photos/${photoId}`)).json()).status, { timeout: 30_000 }).toBe("PROCESSED");
  await kiosk.patch(`/api/v1/sessions/${sessionId}/status`, { data: { status: "COMPLETED", photoCount: 1, retakeCount: 0 }, headers: h });
  await admin.dispose(); await kiosk.dispose();
});

test("a guest opens their QR gallery, sees the photo and can download it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/g/${galleryToken}`);
  await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
  const thumb = page.locator(".gal-grid img, main img").first();
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  const dl = page.getByRole("link", { name: "Download" }).first();
  await expect(dl).toBeVisible();
  const res = await page.request.get((await dl.getAttribute("href"))!);
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("image/jpeg");
  // fits the screen: no sideways scrolling on a phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("an unknown gallery link says so instead of breaking", async ({ page }) => {
  await page.goto(`/g/${randomBytes(32).toString("base64url")}`);
  await expect(page.getByRole("heading", { name: "This link isn't available." })).toBeVisible();
});

test("the admin can sign in and move around", async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Booths" })).toBeVisible({ timeout: 30_000 });
  for (const [tab, heading] of [["Events", "Events."], ["Booths", "Booths."], ["Settings", "Settings."]] as const) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: tab }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  await expect(page.getByRole("heading", { name: "Database backups" })).toBeVisible();
  if (isMobile) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});
