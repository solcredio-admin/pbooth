import { expect, test, type Page } from "@playwright/test";

// The internet drops in the middle of an event: guests keep shooting, the kiosk even gets reloaded,
// and when the network returns every session and photo reaches the cloud exactly once.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3399";
const ADMIN = { email: process.env.E2E_EMAIL ?? "admin@test.local", password: process.env.E2E_PASSWORD ?? "correct-horse-battery" };
const origin = new URL(BASE).origin;

async function guest(page: Page) {
  await page.locator(".k-tap").click(); // one tap: the instructions count down and shooting starts by itself
  await expect(page.locator(".kiosk.ks-review")).toBeVisible({ timeout: 35_000 });
  await page.getByRole("button", { name: "Looks great" }).click();
  await expect(page.locator(".kiosk.ks-done")).toBeVisible();
}

const queued = (page: Page) => page.evaluate(() => new Promise<number>((resolve) => {
  const r = indexedDB.open("pbooth-kiosk");
  r.onsuccess = () => { const q = r.result.transaction("queue").objectStore("queue").count(); q.onsuccess = () => resolve(q.result); };
}));

test("an internet outage loses nothing and duplicates nothing", async ({ browser }) => {
  // ---- admin: a booth booked for a live event, and a kiosk pairing code
  const admin = await browser.newContext();
  const api = admin.request;
  const h = { origin };
  expect((await api.post(`${BASE}/api/v1/auth/login`, { data: ADMIN, headers: h })).ok()).toBe(true);
  const booth = await (await api.post(`${BASE}/api/v1/booths`, { data: { name: `Offline ${Date.now()}` }, headers: h })).json();
  const event = await (await api.post(`${BASE}/api/v1/events`, {
    data: { name: `Outage ${Date.now()}`, date: new Date().toISOString().slice(0, 10), startTime: "00:00", endTime: "23:59", timeZone: "UTC", config: { shotsPerSession: 1, countdownSeconds: 1 } }, headers: h,
  })).json();
  await api.post(`${BASE}/api/v1/events/${event.id}/booths`, { data: { boothId: booth.id }, headers: h });
  await api.post(`${BASE}/api/v1/events/${event.id}/activate`, { headers: h });
  const { code } = await (await api.post(`${BASE}/api/v1/booths/${booth.id}/kiosk-code`, { headers: h })).json();
  const photos = async () => (await (await api.get(`${BASE}/api/v1/events/${event.id}/photos`)).json()) as { total: number; counts: Record<string, number> };

  // ---- kiosk: pair, and one normal online guest
  const kiosk = await browser.newContext();
  const page = await kiosk.newPage();
  await page.goto(`/kiosk/${booth.code}`);
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.locator(".kiosk.ks-welcome")).toBeVisible({ timeout: 30_000 });
  await guest(page);
  await expect.poll(async () => (await photos()).counts.PROCESSED ?? 0, { timeout: 30_000 }).toBe(1);
  // the offline helper has saved a copy of this kiosk
  await expect.poll(() => page.evaluate(async (c) => !!(await (await caches.open("pbooth-kiosk-v1")).match(`/kiosk/${c}`)), booth.code), { timeout: 15_000 }).toBe(true);

  // ---- the internet goes down
  await kiosk.setOffline(true);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".kiosk.ks-welcome")).toBeVisible();
  await guest(page);
  await expect(page.locator(".k-qr")).toContainText("No internet right now");
  expect(await queued(page)).toBeGreaterThanOrEqual(2); // start + photo kept on the kiosk (finish follows on reset)

  // ---- and the kiosk is reloaded while still offline
  await page.reload();
  await expect(page.locator(".kiosk.ks-welcome")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-offline")).toContainText("Offline");
  await guest(page);
  await page.getByRole("button", { name: "Done" }).click();
  expect(await queued(page)).toBeGreaterThanOrEqual(6); // 2 offline guests × (start, photo, finish)

  // ---- the internet comes back: everything lands, once
  await kiosk.setOffline(false);
  await expect.poll(() => queued(page), { timeout: 90_000, intervals: [2000] }).toBe(0);
  await expect.poll(async () => (await photos()).counts.PROCESSED ?? 0, { timeout: 60_000 }).toBe(3);
  const final = await photos();
  expect(final.total).toBe(3);                         // three guest sessions with photos
  expect(final.counts.PROCESSED).toBe(3);              // three designs, no duplicates
  expect(final.counts.FAILED ?? 0).toBe(0);
});
