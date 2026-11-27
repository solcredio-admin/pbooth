import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base, call, login } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;
const IP = "10.0.80.1";

describe.skipIf(!url)("audit log", () => {
  it("shows who changed what, old to new, never secrets; filters, CSV, owner only", async () => {
    const cookie = await login(IP);
    const O = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie, ip: IP, ...init });
    const booth = (await O("/booths", { method: "POST", body: { name: `Audit ${randomUUID().slice(0, 6)}` } })).body;
    await O(`/booths/${booth.id}`, { method: "PATCH", body: { name: `${booth.name} B`, notes: "by the stage" } });
    await O(`/booths/${booth.id}/staff-pin`, { method: "POST", body: { pin: "4829" } });
    const r = (await O(`/audit?entity=${booth.id}`)).body;
    const edit = r.items.find((e: { action: string }) => e.action === "booth.update");
    expect(edit).toMatchObject({ actorName: expect.stringMatching(/\(OWNER\)$/), entityName: `${booth.name} B`, metadata: { changes: { name: [booth.name, `${booth.name} B`], notes: [null, "by the stage"] } } });
    expect(JSON.stringify(r)).not.toContain("4829");
    expect(r.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(["booth.create", "booth.update", "booth.staffPin.set"]));
    expect((await O("/audit?kind=booths")).body.items.every((e: { action: string }) => /^(booth|device|kiosk)\./.test(e.action))).toBe(true);
    expect((await O("/audit?kind=nope")).status).toBe(400);
    const file = await fetch(`${base}/audit/csv?entity=${booth.id}`, { headers: { cookie, "x-forwarded-for": IP } });
    expect(file.headers.get("content-type")).toContain("text/csv");
    expect(await file.text()).toContain("booth.update");

    // only the owner sees it
    const pw = "a-long-test-password", username = `events-${randomUUID().slice(0, 6)}`;
    await O("/users", { method: "POST", body: { username, password: pw, role: "EVENTS" } });
    const ev = (await call("/auth/login", { method: "POST", ip: "10.0.80.2", body: { username, password: pw } })).setCookie!.split(";")[0];
    expect((await call("/audit", { cookie: ev, ip: "10.0.80.2" })).status).toBe(403);
  });
});
