import { describe, expect, inject, it } from "vitest";

const base = inject("apiBase");
const ORIGIN = "http://app.test";
const ADMIN = { email: "admin@test.local", password: "correct-horse-battery" };

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  const res = await fetch(base + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") };
}

async function login() {
  const r = await call("/auth/login", { method: "POST", body: ADMIN });
  expect(r.status).toBe(200);
  return r.setCookie!.split(";")[0];
}

const newEvent = {
  name: "Reyes Wedding", organizerName: "Ana Reyes", venueName: "Casa Loma",
  date: "2026-12-05", startTime: "18:00", endTime: "01:00", timeZone: "Asia/Manila",
};

describe.skipIf(!base)("API against a real database", () => {
  it("reports health", async () => {
    expect((await call("/health")).body).toEqual({ status: "ok" });
  });

  it("rejects wrong credentials with no cookie", async () => {
    const r = await call("/auth/login", { method: "POST", body: { ...ADMIN, password: "wrong-password-123" } });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(r.setCookie).toBeNull();
  });

  it("issues an HttpOnly, SameSite=Strict session cookie and signs out for real", async () => {
    const r = await call("/auth/login", { method: "POST", body: ADMIN });
    expect(r.setCookie).toMatch(/pb_session=.+HttpOnly/i);
    expect(r.setCookie).toMatch(/SameSite=Strict/i);
    const cookie = r.setCookie!.split(";")[0];
    expect((await call("/auth/me", { cookie })).body.admin.email).toBe(ADMIN.email);
    expect((await call("/auth/logout", { method: "POST", cookie })).status).toBe(204);
    expect((await call("/auth/me", { cookie })).status).toBe(401); // the old cookie is dead server-side
  });

  it("requires a session for everything private", async () => {
    expect((await call("/events")).status).toBe(401);
    expect((await call("/auth/me")).status).toBe(401);
    expect((await call("/events", { cookie: "pb_session=forged" })).status).toBe(401);
  });

  it("blocks cross-site writes (CSRF)", async () => {
    const cookie = await login();
    const r = await call("/events", { method: "POST", body: newEvent, cookie, origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("BAD_ORIGIN");
  });

  it("creates, edits and lists events, keeping venue-local times", async () => {
    const cookie = await login();
    const created = await call("/events", { method: "POST", body: newEvent, cookie });
    expect(created.status).toBe(201);
    const e = created.body;
    expect(e.status).toBe("DRAFT");
    expect(e.startsAt).toBe("2026-12-05T10:00:00.000Z");
    expect(e.endsAt).toBe("2026-12-05T17:00:00.000Z"); // 01:00 the next day in Manila
    expect(e.local).toEqual({ date: "2026-12-05", startTime: "18:00", endTime: "01:00" });
    expect(e.config.countdownSeconds).toBe(3);

    const patched = await call(`/events/${e.id}`, { method: "PATCH", body: { name: "Reyes–Cruz Wedding", config: { printEnabled: true } }, cookie });
    expect(patched.body.name).toBe("Reyes–Cruz Wedding");
    expect(patched.body.config.printEnabled).toBe(true);

    const list = await call("/events?q=cruz", { cookie });
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(e.id);
  });

  it("validates input with field-level messages", async () => {
    const cookie = await login();
    const r = await call("/events", { method: "POST", body: { ...newEvent, name: "", timeZone: "Mars/Olympus" }, cookie });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect(r.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["name", "timeZone"]);
    expect((await call("/events/not-a-uuid", { cookie })).status).toBe(400);
    expect((await call("/events/00000000-0000-4000-8000-000000000000", { cookie })).status).toBe(404);
  });

  it("enforces the status lifecycle", async () => {
    const cookie = await login();
    const { body: e } = await call("/events", { method: "POST", body: newEvent, cookie });
    expect((await call(`/events/${e.id}/complete`, { method: "POST", cookie })).status).toBe(409);
    expect((await call(`/events/${e.id}/schedule`, { method: "POST", cookie })).body.status).toBe("SCHEDULED");
    const active = await call(`/events/${e.id}/activate`, { method: "POST", cookie });
    expect(active.body.status).toBe("ACTIVE");
    expect(active.body.actions).toEqual(["complete"]);
    expect((await call(`/events/${e.id}/archive`, { method: "POST", cookie })).status).toBe(409);
    expect((await call(`/events/${e.id}/complete`, { method: "POST", cookie })).body.status).toBe("COMPLETED");
    expect((await call(`/events/${e.id}/archive`, { method: "POST", cookie })).body.status).toBe("ARCHIVED");
    const edit = await call(`/events/${e.id}`, { method: "PATCH", body: { name: "x" }, cookie });
    expect(edit.status).toBe(409);
    const summary = await call("/events/summary", { cookie });
    expect(summary.body.byStatus.ARCHIVED).toBeGreaterThanOrEqual(1);
  });

  it("changes the password and signs out other sessions", async () => {
    const a = await login();
    const b = await login();
    const next = "another-long-password";
    expect((await call("/auth/password", { method: "POST", body: { currentPassword: ADMIN.password, newPassword: "short" }, cookie: a })).status).toBe(400);
    expect((await call("/auth/password", { method: "POST", body: { currentPassword: ADMIN.password, newPassword: next }, cookie: a })).status).toBe(204);
    expect((await call("/auth/me", { cookie: a })).status).toBe(200);
    expect((await call("/auth/me", { cookie: b })).status).toBe(401);
    // put it back for the other tests
    await call("/auth/password", { method: "POST", body: { currentPassword: next, newPassword: ADMIN.password }, cookie: a });
  });

  // Last: it uses up this IP's login allowance.
  it("rate-limits repeated sign-in attempts", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call("/auth/login", { method: "POST", body: { ...ADMIN, password: "nope-nope-nope" } })).status;
    expect(last).toBe(429);
  });
});
