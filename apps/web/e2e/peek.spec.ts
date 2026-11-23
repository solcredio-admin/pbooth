import { expect, request, test } from "@playwright/test";

// Multi-photo sessions: each photo shows the instant the shutter fires, in a tilted instant-print
// frame over the live camera, mirrored like the live preview, for the event's preview time; a tap on
// Retake redoes that photo and the sequence carries on; the session ends with every photo.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3399";
const ADMIN = { username: process.env.E2E_USERNAME ?? "admin@test.local", password: process.env.E2E_PASSWORD ?? "correct-horse-battery" };
const h = { origin: new URL(BASE).origin };

test("each photo shows in a frame instantly, can be retaken, then the sequence goes on", async ({ browser }) => {
  const admin = await request.newContext({ baseURL: BASE });
  expect((await admin.post("/api/v1/auth/login", { data: ADMIN, headers: h })).ok()).toBe(true);
  const booth = await (await admin.post("/api/v1/booths", { data: { name: `Peek ${Date.now()}` }, headers: h })).json();
  const event = await (await admin.post("/api/v1/events", {
    data: { name: `Peek ${Date.now()}`, date: new Date().toISOString().slice(0, 10), startTime: "00:00", endTime: "23:59", timeZone: "UTC", config: { shotsPerSession: 3, countdownSeconds: 1, captureIntervalSeconds: 1, previewSeconds: 2 } }, headers: h,
  })).json();
  expect(event.config.previewSeconds).toBe(2);
  await admin.post(`/api/v1/events/${event.id}/booths`, { data: { boothId: booth.id }, headers: h });
  await admin.post(`/api/v1/events/${event.id}/activate`, { headers: h });
  const { code } = await (await admin.post(`/api/v1/booths/${booth.id}/kiosk-code`, { headers: h })).json();

  const page = await (await browser.newContext()).newPage();
  await page.goto(`/kiosk/${booth.code}`);
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.locator(".kiosk.ks-welcome")).toBeVisible({ timeout: 30_000 });
  await page.locator(".k-tap").click();
  await page.getByRole("button", { name: "Start now" }).click(); // skip the 10 s instructions

  // photo 1: shows instantly in its frame, over the live camera
  await page.locator(".k-flash").waitFor({ state: "attached", timeout: 20_000 });
  const shutter = Date.now();
  await expect(page.locator(".k-polaroid img")).toBeVisible({ timeout: 2_000 });
  expect(Date.now() - shutter, "preview delay").toBeLessThan(500);
  await expect(page.locator(".k-polaroid img")).toHaveClass(/mirror/); // booths mirror the preview by default
  await expect(page.locator(".k-polaroid-cap")).toHaveText("Photo 1 of 3");
  await expect(page.locator(".k-view video")).toBeVisible(); // the live camera stays behind the frame

  // retake it: a fresh countdown for photo 1, then the sequence continues
  await page.getByRole("button", { name: "Retake" }).click();
  await expect(page.locator(".k-peek")).toBeHidden();
  await expect(page.locator(".k-shot")).toHaveText("Retaking photo 1");
  await expect(page.locator(".k-polaroid-cap")).toHaveText("Photo 1 of 3", { timeout: 15_000 }); // the new photo 1

  // photo 1 (again) and photo 2 each show for the event's 2 s, then the next countdown starts
  const shown = Date.now();
  await expect(page.locator(".k-peek")).toBeHidden({ timeout: 6_000 });
  expect(Date.now() - shown, "preview time").toBeLessThan(3_500);
  await expect(page.locator(".k-polaroid-cap")).toHaveText("Photo 2 of 3", { timeout: 15_000 });
  await expect(page.locator(".k-peek")).toBeHidden({ timeout: 6_000 });

  await expect(page.locator(".kiosk.ks-review")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".k-pick")).toHaveCount(3); // three photos, the retaken one replaced
  await admin.dispose();
});
