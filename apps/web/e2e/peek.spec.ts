import { expect, request, test } from "@playwright/test";

// Multi-photo sessions: each photo shows the instant the shutter fires (a copy of the live frame),
// mirrored like the live preview, before the next countdown; the session still ends with every photo.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3399";
const ADMIN = { username: process.env.E2E_USERNAME ?? "admin@test.local", password: process.env.E2E_PASSWORD ?? "correct-horse-battery" };
const h = { origin: new URL(BASE).origin };

test("the photo preview appears instantly after each shot", async ({ browser }) => {
  const admin = await request.newContext({ baseURL: BASE });
  expect((await admin.post("/api/v1/auth/login", { data: ADMIN, headers: h })).ok()).toBe(true);
  const booth = await (await admin.post("/api/v1/booths", { data: { name: `Peek ${Date.now()}` }, headers: h })).json();
  const event = await (await admin.post("/api/v1/events", {
    data: { name: `Peek ${Date.now()}`, date: new Date().toISOString().slice(0, 10), startTime: "00:00", endTime: "23:59", timeZone: "UTC", config: { shotsPerSession: 3, countdownSeconds: 1, captureIntervalSeconds: 1 } }, headers: h,
  })).json();
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

  for (const n of [1, 2]) {
    await page.locator(".k-flash").waitFor({ state: "attached", timeout: 20_000 });
    const shutter = Date.now();
    await expect(page.locator(".k-peek img")).toBeVisible({ timeout: 2_000 });
    expect(Date.now() - shutter, `preview ${n} delay`).toBeLessThan(500);
    await expect(page.locator(".k-peek img")).toHaveClass(/mirror/); // booths mirror the preview by default
    await expect(page.locator(".k-peek .k-shot")).toContainText(`Photo ${n} of 3`);
    await expect(page.locator(".k-peek")).toBeHidden({ timeout: 6_000 }); // then the next countdown
  }
  await expect(page.locator(".kiosk.ks-review")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".k-pick")).toHaveCount(3);
  await admin.dispose();
});
