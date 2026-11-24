import { expect, request, test } from "@playwright/test";

// Self-service booths look after themselves: a guest asks for help with their reference, staff get in with
// a PIN, and the owner sees the request and gives a new voucher.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3399";
const ADMIN = { username: process.env.E2E_USERNAME ?? "admin@test.local", password: process.env.E2E_PASSWORD ?? "correct-horse-battery" };
const h = { origin: new URL(BASE).origin };
const SHOTS = process.env.E2E_SHOTS;

test("help with a payment reference, and the hidden staff menu", async ({ browser }) => {
  const admin = await request.newContext({ baseURL: BASE });
  expect((await admin.post("/api/v1/auth/login", { data: ADMIN, headers: h })).ok()).toBe(true);
  const name = `Help café ${Date.now()}`;
  const booth = await (await admin.post("/api/v1/booths", { data: { name: `Booth ${name}` }, headers: h })).json();
  const event = await (await admin.post("/api/v1/events", { headers: h, data: { name, kind: "SELF_SERVICE", priceCentavos: 15000, date: new Date().toISOString().slice(0, 10), startTime: "00:00", endTime: "23:59", timeZone: "UTC", config: { shotsPerSession: 1, countdownSeconds: 1 } } })).json();
  await admin.post(`/api/v1/events/${event.id}/booths`, { data: { boothId: booth.id }, headers: h });
  await admin.post(`/api/v1/events/${event.id}/activate`, { headers: h });
  await admin.post(`/api/v1/booths/${booth.id}/staff-pin`, { data: { pin: "4829" }, headers: h });
  const { codes } = await (await admin.post(`/api/v1/events/${event.id}/vouchers`, { data: { kind: "ONE_TIME", count: 1 }, headers: h })).json();
  const { code } = await (await admin.post(`/api/v1/booths/${booth.id}/kiosk-code`, { headers: h })).json();
  const page = await (await browser.newContext()).newPage();
  const shot = async (n: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
  await page.goto(`/kiosk/${booth.code}`);
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.locator(".kiosk.ks-welcome")).toBeVisible({ timeout: 30_000 });
  await shot("1-welcome");

  // pay, see the reference, finish
  await page.locator(".k-tap").click();
  await page.locator(".k-voucher input").fill(codes[0]);
  await page.getByRole("button", { name: "Use voucher" }).click();
  const reference = (await page.locator(".ks-choose .k-ref b").textContent())!;
  expect(reference).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await page.locator(".k-choice.num").filter({ hasText: "1" }).click();
  await page.getByRole("button", { name: /4R landscape/ }).click();
  await page.getByRole("button", { name: "Start now" }).click();
  await page.getByRole("button", { name: "Looks great" }).click({ timeout: 30_000 });
  await expect(page.locator(".ks-done .k-ref b")).toHaveText(reference);
  await shot("2-done");
  await page.getByRole("button", { name: "Done" }).click();

  // ask for help: a wrong reference is refused, the right one tells the staff
  await page.getByRole("button", { name: "Need help or a refund?" }).click();
  await shot("3-help");
  await page.getByRole("button", { name: "My photos didn't print" }).click();
  await expect(page.locator(".k-help .k-chip")).toHaveCount(1); // the payment just made
  const type = async (c: string) => { await page.getByRole("button", { name: "Clear" }).click(); for (const ch of c.replace("-", "")) await page.locator(".k-keypad").getByRole("button", { name: ch, exact: true }).click(); };
  await type("0000-0000");
  await page.getByRole("button", { name: "Ask for help" }).click();
  await expect(page.locator(".k-help .k-error")).toContainText("can't find that reference");
  await type(reference);
  await shot("4-reference");
  await page.getByRole("button", { name: "Ask for help" }).click();
  await expect(page.locator(".k-help")).toContainText("staff have been notified");
  await shot("5-thanks");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".kiosk.ks-welcome")).toBeVisible();

  // staff: a tap in the corner does nothing; holding it asks for the PIN
  await page.mouse.click(20, 120);
  await page.waitForTimeout(300);
  if (await page.locator(".kiosk.ks-pay").count()) await page.getByRole("button", { name: "Cancel" }).click();
  await page.mouse.move(30, 60); await page.mouse.down(); await page.waitForTimeout(3300); await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Staff" })).toBeVisible();
  const pin = async (p: string) => { for (const d of p) await page.locator(".k-pins").getByRole("button", { name: d, exact: true }).click(); await page.getByRole("button", { name: "Enter" }).click(); };
  await pin("1111");
  await expect(page.locator(".k-staff .k-error")).toContainText("isn't right");
  await shot("6-pin");
  await pin("4829");
  await expect(page.getByRole("button", { name: "Reload the kiosk" })).toBeVisible();
  await shot("7-staff");

  // the owner: one request, answered with a voucher shown once; the sale is in Transactions
  const ctx = await browser.newContext({ storageState: await admin.storageState(), viewport: { width: 1400, height: 1000 } });
  const desk = await ctx.newPage();
  const problems: string[] = [];
  desk.on("pageerror", (e) => problems.push(e.message));
  await desk.goto("/refunds");
  const row = desk.locator(".refunds li").filter({ hasText: reference });
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  if (SHOTS) await desk.screenshot({ path: `${SHOTS}/8-refunds.png` });
  await row.getByRole("button", { name: "New voucher" }).click();
  await desk.getByRole("button", { name: "Make the voucher" }).click();
  await expect(desk.locator(".enroll-code")).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(desk.locator("section[aria-labelledby=done] .refunds li").filter({ hasText: reference })).toContainText("New voucher given");
  await desk.goto(`/transactions?eventId=${event.id}`);
  await expect(desk.locator("table")).toContainText(reference);
  await expect(desk.locator(".totals")).toContainText("₱150");
  if (SHOTS) await desk.screenshot({ path: `${SHOTS}/9-transactions.png` });
  const csv = await ctx.request.get(`/api/v1/transactions/export.csv?eventId=${event.id}`);
  expect(await csv.text()).toContain(reference);
  if (SHOTS) {
    await desk.goto("/settings"); await desk.getByRole("tab", { name: "Alerts" }).click(); await desk.screenshot({ path: `${SHOTS}/10-alerts.png` });
    await desk.goto(`/booths/${booth.id}`); await desk.getByRole("tab", { name: "Connect" }).click(); await desk.locator("#lock").scrollIntoViewIfNeeded(); await desk.locator("section[aria-labelledby=lock]").screenshot({ path: `${SHOTS}/11-lockdown.png` });
  }
  expect(problems).toEqual([]);
  await admin.dispose();
});
