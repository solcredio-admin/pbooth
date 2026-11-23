import { expect, request, test } from "@playwright/test";

// Self-service: the kiosk asks for a voucher before the session; a used code is refused.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3399";
const ADMIN = { username: process.env.E2E_USERNAME ?? "admin@test.local", password: process.env.E2E_PASSWORD ?? "correct-horse-battery" };
const h = { origin: new URL(BASE).origin };

test("a guest enters a voucher at a self-service booth", async ({ browser }) => {
  const admin = await request.newContext({ baseURL: BASE });
  expect((await admin.post("/api/v1/auth/login", { data: ADMIN, headers: h })).ok()).toBe(true);
  const booth = await (await admin.post("/api/v1/booths", { data: { name: `Café kiosk ${Date.now()}` }, headers: h })).json();
  const event = await (await admin.post("/api/v1/events", {
    data: { name: `Café e2e ${Date.now()}`, kind: "SELF_SERVICE", priceCentavos: 15000, date: new Date().toISOString().slice(0, 10), startTime: "00:00", endTime: "23:59", timeZone: "UTC", config: { shotsPerSession: 1, countdownSeconds: 1 } }, headers: h,
  })).json();
  await admin.post(`/api/v1/events/${event.id}/booths`, { data: { boothId: booth.id }, headers: h });
  await admin.post(`/api/v1/events/${event.id}/activate`, { headers: h });
  const { codes } = await (await admin.post(`/api/v1/events/${event.id}/vouchers`, { data: { kind: "ONE_TIME", count: 1 }, headers: h })).json();
  const { code } = await (await admin.post(`/api/v1/booths/${booth.id}/kiosk-code`, { headers: h })).json();

  const page = await (await browser.newContext()).newPage();
  await page.goto(`/kiosk/${booth.code}`);
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.locator(".kiosk.ks-welcome")).toBeVisible({ timeout: 30_000 });

  await page.locator(".k-tap").click();
  await expect(page.locator(".kiosk.ks-pay")).toBeVisible();
  await expect(page.locator(".k-pay .k-title")).toHaveText("₱150");
  await page.locator(".k-voucher input").fill("ZZZZ-ZZZZ");
  await page.getByRole("button", { name: "Use voucher" }).click();
  await expect(page.locator(".k-pay .k-error")).toContainText("isn't valid");

  await page.locator(".k-voucher input").fill(codes[0]);
  await page.getByRole("button", { name: "Use voucher" }).click();
  await expect(page.locator(".kiosk.ks-ready")).toBeVisible(); // paid: on to "Get ready"
  await page.getByRole("button", { name: "Start now" }).click();
  await expect(page.locator(".kiosk.ks-review")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Looks great" }).click();
  await expect(page.locator(".kiosk.ks-done")).toBeVisible();

  // the same code a second time is refused
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator(".k-tap").click();
  await page.locator(".k-voucher input").fill(codes[0]);
  await page.getByRole("button", { name: "Use voucher" }).click();
  await expect(page.locator(".k-pay .k-error")).toContainText("already been used");

  const rev = await (await admin.get(`/api/v1/events/${event.id}/revenue`)).json();
  expect(rev.all).toMatchObject({ sessions: 1, amountCentavos: 15000 });
  await admin.dispose();
});
