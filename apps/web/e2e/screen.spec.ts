import { expect, request, test } from "@playwright/test";

// The kiosk fills any screen shape (here an iPad's ~4:3) and captures exactly what's on screen;
// the crop guide still shows what the print design keeps.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3399";
const ADMIN = { username: process.env.E2E_USERNAME ?? "admin@test.local", password: process.env.E2E_PASSWORD ?? "correct-horse-battery" };
const h = { origin: new URL(BASE).origin };

test("preview and photo take the screen's shape (iPad 4:3)", async ({ browser }) => {
  const admin = await request.newContext({ baseURL: BASE });
  expect((await admin.post("/api/v1/auth/login", { data: ADMIN, headers: h })).ok()).toBe(true);
  const booth = await (await admin.post("/api/v1/booths", { data: { name: `iPad shape ${Date.now()}` }, headers: h })).json();
  const event = await (await admin.post("/api/v1/events", {
    data: { name: `Shape ${Date.now()}`, date: new Date().toISOString().slice(0, 10), startTime: "00:00", endTime: "23:59", timeZone: "UTC", config: { shotsPerSession: 2, countdownSeconds: 1, captureIntervalSeconds: 1, layout: "strip" } }, headers: h,
  })).json();
  await admin.post(`/api/v1/events/${event.id}/booths`, { data: { boothId: booth.id }, headers: h });
  await admin.post(`/api/v1/events/${event.id}/activate`, { headers: h });
  const { code } = await (await admin.post(`/api/v1/booths/${booth.id}/kiosk-code`, { headers: h })).json();

  const page = await (await browser.newContext({ viewport: { width: 1194, height: 834 } })).newPage(); // iPad Pro 11, landscape
  await page.goto(`/kiosk/${booth.code}`);
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.locator(".kiosk.ks-welcome")).toBeVisible({ timeout: 30_000 });

  const view = await page.locator(".k-view").boundingBox();
  expect(Math.round(view!.width)).toBe(1194); // no black bars: the preview is the whole screen
  expect(Math.round(view!.height)).toBe(834);

  await page.locator(".k-tap").click();
  await page.getByRole("button", { name: "Start now" }).click();
  await expect(page.locator(".k-safe")).toBeVisible(); // strip slots are near-square: the guide shows the crop
  await expect(page.locator(".kiosk.ks-review")).toBeVisible({ timeout: 30_000 });
  const ratio = await page.locator(".k-pick img").first().evaluate((i: HTMLImageElement) => i.naturalWidth / i.naturalHeight);
  expect(ratio).toBeCloseTo(1194 / 834, 1); // the photo has the screen's shape
  await admin.dispose();
});
