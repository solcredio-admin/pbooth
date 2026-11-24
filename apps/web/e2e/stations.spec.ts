import { expect, request, test } from "@playwright/test";

// A booth prints at a station somewhere else: the kiosk sends it, the guest sees their place and where to
// collect it, and staff see it in the line. The station's computer is played by the test.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3399";
const ADMIN = { username: process.env.E2E_USERNAME ?? "admin@test.local", password: process.env.E2E_PASSWORD ?? "correct-horse-battery" };
const h = { origin: new URL(BASE).origin };
const SHOTS = process.env.E2E_SHOTS;

test("a guest's print goes to a station in another room", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = await request.newContext({ baseURL: BASE });
  expect((await admin.post("/api/v1/auth/login", { data: ADMIN, headers: h })).ok()).toBe(true);
  const post = async (path: string, data?: object) => (await admin.post(`/api/v1${path}`, { data, headers: h })).json();
  const stamp = Date.now();
  const booth = await post("/booths", { name: `Room A ${stamp}` });
  const event = await post("/events", { name: `Stations ${stamp}`, date: new Date().toISOString().slice(0, 10), startTime: "00:00", endTime: "23:59", timeZone: "UTC", config: { shotsPerSession: 1, countdownSeconds: 1, printEnabled: true } });
  await post(`/events/${event.id}/booths`, { boothId: booth.id });
  await post(`/events/${event.id}/activate`);
  const main = await post("/stations", { name: `Front desk ${stamp}` }), backup = await post("/stations", { name: `Back room ${stamp}` });
  const { code: sc } = await post(`/stations/${main.id}/enrollment-code`);
  const agent = await request.newContext({ baseURL: BASE });
  const { token } = await (await agent.post("/api/v1/devices/enroll", { data: { code: sc, stations: true, device: { identifier: `pc-${stamp}`, hostname: "front-desk" } } })).json();
  const auth = { authorization: `Bearer ${token}` };
  const poll = async () => (await agent.post("/api/v1/station/poll", { headers: auth, data: { ready: true } })).json();
  const report = (id: string, attempt: number, status: string) => agent.post(`/api/v1/station/jobs/${id}`, { headers: auth, data: { attempt, status } });

  // link both on the booth's page, and try both ways of using them
  const adminPage = await (await browser.newContext({ storageState: await admin.storageState() })).newPage();
  await adminPage.goto(`/booths/${booth.id}`);
  await adminPage.getByRole("tab", { name: "Hardware" }).click();
  const add = adminPage.getByLabel("Add a station");
  await add.selectOption(main.id);
  await expect(adminPage.getByText("No station linked")).toHaveCount(0);
  await add.selectOption(backup.id);
  await expect(adminPage.getByText(/Main · /)).toBeVisible();
  await adminPage.getByLabel(/Rotate/).click();
  await expect(adminPage.getByText(/Main · /)).toHaveCount(0);
  await adminPage.getByLabel(/Fixed list/).click();
  await expect(adminPage.getByText(/Backup · /)).toBeVisible();
  if (SHOTS) await adminPage.screenshot({ path: `${SHOTS}/st-booth.png`, fullPage: true });

  const { code } = await post(`/booths/${booth.id}/kiosk-code`);
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/kiosk/${booth.code}`);
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.locator(".kiosk.ks-welcome")).toBeVisible({ timeout: 30_000 });
  await page.locator(".k-tap").click();
  await page.getByRole("button", { name: "Start now" }).click();
  await page.getByRole("button", { name: "Looks great" }).click({ timeout: 30_000 });
  await expect(page.locator(".k-print")).toHaveText(/waiting for a free printer/, { timeout: 30_000 }); // no station is on

  await adminPage.goto("/dashboard");
  await expect(adminPage.getByRole("link", { name: new RegExp(`Front desk ${stamp}`) })).toBeVisible();
  if (SHOTS) await adminPage.screenshot({ path: `${SHOTS}/st-dash.png` });
  await adminPage.goto("/stations");
  await expect(adminPage.getByRole("heading", { name: "In line" })).toBeVisible();
  await expect(adminPage.getByText(`Room A ${stamp}`).first()).toBeVisible();
  if (SHOTS) await adminPage.screenshot({ path: `${SHOTS}/st-board.png`, fullPage: true });

  const [job] = (await poll()).jobs;
  await report(job.id, job.attempt, "PRINTING");
  await expect(page.locator(".k-print")).toHaveText(`Printing your photos at Front desk ${stamp}…`, { timeout: 10_000 });
  await report(job.id, job.attempt, "DONE");
  await expect(page.locator(".k-print")).toHaveText(`Printed! Collect it at Front desk ${stamp}.`, { timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/st-kiosk.png` });
  await adminPage.goto(`/stations/${main.id}`);
  await expect(adminPage.getByLabel("Station name")).toHaveValue(`Front desk ${stamp}`);
  if (SHOTS) await adminPage.screenshot({ path: `${SHOTS}/st-detail.png`, fullPage: true });
});
