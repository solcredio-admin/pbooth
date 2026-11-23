import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, inject, it } from "vitest";
import { call, login, newEvent } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;
const PW = "a-long-test-password";

describe.skipIf(!url)("self-service events: vouchers, payments, cashiers", () => {
  it("a paid session needs a voucher; one-time codes work once, unlimited ones are free; revenue adds up", async () => {
    const IP = "10.0.30.1";
    const O = async (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie: owner, ip: IP, ...init });
    const owner = await login(IP);
    const stamp = Date.now();

    // a café location at ₱150, shared 20% with the café
    const ev = (await O("/events", { method: "POST", body: { ...newEvent, name: `Café ${stamp}`, kind: "SELF_SERVICE", priceCentavos: 15000, partnerName: "Kape Tayo", partnerSharePercent: 20 } })).body;
    expect(ev).toMatchObject({ kind: "SELF_SERVICE", priceCentavos: 15000, freeSessions: false, partnerSharePercent: 20 });
    const booth = (await O("/booths", { method: "POST", body: { name: `Café booth ${stamp}` } })).body;
    await O(`/events/${ev.id}/booths`, { method: "POST", body: { boothId: booth.id } });
    await O(`/events/${ev.id}/activate`, { method: "POST" });
    const { code } = (await O(`/booths/${booth.id}/kiosk-code`, { method: "POST" })).body;
    const kiosk = (await call("/kiosk/pair", { method: "POST", ip: IP, body: { boothCode: booth.code, code } })).setCookie!.split(";")[0];
    const K = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie: kiosk, ip: IP, ...init });
    const cfg = (await K(`/kiosk/config?booth=${booth.code}`)).body;
    expect(cfg.event.selfService).toEqual({ priceCentavos: 15000, currency: "PHP", freeSessions: false, qr: true });

    const start = (paymentId?: string) => K("/sessions", { method: "POST", body: { id: randomUUID(), galleryToken: randomBytes(32).toString("base64url"), ...(paymentId ? { paymentId } : {}) } });
    expect((await start()).body.error.code).toBe("PAYMENT_REQUIRED"); // no voucher, no session

    // the owner makes 2 one-time codes and an unlimited one
    const oneTime = (await O(`/events/${ev.id}/vouchers`, { method: "POST", body: { kind: "ONE_TIME", count: 2, label: "Test batch" } })).body;
    expect(oneTime.codes).toHaveLength(2);
    const unli = (await O(`/events/${ev.id}/vouchers`, { method: "POST", body: { kind: "UNLIMITED" } })).body;
    expect(unli.codes).toHaveLength(1);

    expect((await K("/kiosk/redeem", { method: "POST", body: { code: "ZZZZ-ZZZZ" } })).body.error.code).toBe("INVALID_VOUCHER");
    const paid = (await K("/kiosk/redeem", { method: "POST", body: { code: oneTime.codes[0].toLowerCase() } })).body; // case doesn't matter
    expect(paid.paymentId).toBeTruthy();
    expect((await start(paid.paymentId)).status).toBe(201);
    expect((await start(paid.paymentId)).body.error.code).toBe("PAYMENT_REQUIRED"); // a payment unlocks one session
    expect((await K("/kiosk/redeem", { method: "POST", body: { code: oneTime.codes[0] } })).body.error.code).toBe("INVALID_VOUCHER"); // used

    for (let i = 0; i < 2; i++) { // unlimited: again and again, free
      const p = (await K("/kiosk/redeem", { method: "POST", body: { code: unli.codes[0] } })).body;
      expect(p.complimentary).toBe(true);
      expect((await start(p.paymentId)).status).toBe(201);
    }

    // a voided code stops working
    const list = (await O(`/events/${ev.id}/vouchers`)).body.items as { id: string; hint: string; uses: number }[];
    const second = list.find((v) => oneTime.codes[1].endsWith(v.hint))!;
    expect((await O(`/events/${ev.id}/vouchers/${second.id}/void`, { method: "POST" })).status).toBe(200);
    expect((await K("/kiosk/redeem", { method: "POST", body: { code: oneTime.codes[1] } })).body.error.code).toBe("INVALID_VOUCHER");

    const rev = (await O(`/events/${ev.id}/revenue`)).body;
    expect(rev.all).toMatchObject({ sessions: 3, complimentary: 2, amountCentavos: 15000, partnerShareCentavos: 3000 });
    expect(rev.today.amountCentavos).toBe(15000);
    expect(rev.unusedOneTimeVouchers).toBe(0);

    // free mode: no payment, no prints, vouchers not needed
    await O(`/events/${ev.id}`, { method: "PATCH", body: { freeSessions: true } });
    const freeCfg = (await K(`/kiosk/config?booth=${booth.code}`)).body;
    expect(freeCfg.event.selfService.freeSessions).toBe(true);
    expect(freeCfg.event.guest.printEnabled).toBe(false);
    expect((await start()).status).toBe(201);
    expect((await K("/kiosk/redeem", { method: "POST", body: { code: unli.codes[0] } })).body.error.code).toBe("NO_PAYMENT_NEEDED");
    expect((await O(`/events/${ev.id}/revenue`)).body.all.byMethod.FREE.sessions).toBe(1);
  });

  it("cashiers run only their assigned events and can't touch price, share or unlimited codes", async () => {
    const IP = "10.0.31.1";
    const owner = await login(IP);
    const O = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie: owner, ip: IP, ...init });
    const stamp = Date.now();
    const ev = (await O("/events", { method: "POST", body: { ...newEvent, name: `Mall ${stamp}`, kind: "SELF_SERVICE" } })).body;
    const other = (await O("/events", { method: "POST", body: { ...newEvent, name: `Other ${stamp}`, kind: "SELF_SERVICE" } })).body;
    const cashier = (await O("/users", { method: "POST", body: { username: `cashier-${stamp}`, password: PW, role: "CASHIER" } })).body;
    const cookie = (await call("/auth/login", { method: "POST", ip: "10.0.31.2", body: { username: cashier.username, password: PW } })).setCookie!.split(";")[0];
    const C = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie, ip: "10.0.31.2", ...init });

    expect((await C(`/events/${ev.id}`)).status).toBe(404); // not assigned yet: invisible
    expect((await C("/events")).body.items).toHaveLength(0);
    expect((await C(`/events/${ev.id}/cashiers`, { method: "PUT", body: { adminIds: [cashier.id] } })).status).toBe(403); // only the owner assigns
    expect((await O(`/events/${ev.id}/cashiers`, { method: "PUT", body: { adminIds: [cashier.id] } })).body.cashiers).toEqual([{ id: cashier.id, username: cashier.username }]);

    expect((await C(`/events/${ev.id}`)).status).toBe(200);
    expect((await C("/events")).body.items.map((e: { id: string }) => e.id)).toEqual([ev.id]);
    expect((await C(`/events/${other.id}`)).status).toBe(404);
    expect((await C(`/events/${other.id}/vouchers`)).status).toBe(404);

    expect((await C(`/events/${ev.id}`, { method: "PATCH", body: { venueName: "Level 2 atrium" } })).status).toBe(200);
    expect((await C(`/events/${ev.id}`, { method: "PATCH", body: { priceCentavos: 100 } })).status).toBe(403);
    expect((await C(`/events/${ev.id}`, { method: "PATCH", body: { partnerSharePercent: 90 } })).status).toBe(403);
    expect((await C(`/events/${ev.id}/activate`, { method: "POST" })).status).toBe(200);
    expect((await C(`/events/${other.id}/activate`, { method: "POST" })).status).toBe(404);

    expect((await C(`/events/${ev.id}/vouchers`, { method: "POST", body: { kind: "ONE_TIME", count: 3 } })).body.codes).toHaveLength(3);
    expect((await C(`/events/${ev.id}/vouchers`, { method: "POST", body: { kind: "UNLIMITED" } })).status).toBe(403);
    expect((await C(`/events/${ev.id}/revenue`)).status).toBe(200);

    expect((await C("/events", { method: "POST", body: { ...newEvent, name: "nope" } })).status).toBe(403);
    expect((await C("/booths")).status).toBe(403);
    expect((await C(`/events/${ev.id}/photos`)).status).toBe(403);
    expect((await C("/users")).status).toBe(403);

    // managed events have no vouchers
    const managed = (await O("/events", { method: "POST", body: { ...newEvent, name: `Wedding ${stamp}` } })).body;
    expect((await O(`/events/${managed.id}/vouchers`, { method: "POST", body: { kind: "ONE_TIME", count: 1 } })).body.error.code).toBe("NOT_SELF_SERVICE");
  });

  it("scan to pay: a PayMongo QR unlocks a session only once PayMongo itself says it's paid, for the right amount", async () => {
    const IP = "10.0.30.9";
    const owner = await login(IP);
    const O = async (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie: owner, ip: IP, ...init });
    const stamp = Date.now();
    const ev = (await O("/events", { method: "POST", body: { ...newEvent, name: `QR café ${stamp}`, kind: "SELF_SERVICE", priceCentavos: 15000 } })).body;
    const booth = (await O("/booths", { method: "POST", body: { name: `QR booth ${stamp}` } })).body;
    await O(`/events/${ev.id}/booths`, { method: "POST", body: { boothId: booth.id } });
    await O(`/events/${ev.id}/activate`, { method: "POST" });
    const { code } = (await O(`/booths/${booth.id}/kiosk-code`, { method: "POST" })).body;
    const kiosk = (await call("/kiosk/pair", { method: "POST", ip: IP, body: { boothCode: booth.code, code } })).setCookie!.split(";")[0];
    const K = (path: string, init: Parameters<typeof call>[1] = {}) => call(path, { cookie: kiosk, ip: IP, ...init });
    const start = (paymentId: string) => K("/sessions", { method: "POST", body: { id: randomUUID(), galleryToken: randomBytes(32).toString("base64url"), paymentId } });
    const pm = inject("paymongo");
    const pay = (intent: string, amount?: number) => fetch(`${pm}/test/pay/${intent}`, { method: "POST", headers: { authorization: `Basic ${Buffer.from("sk_test_mock:").toString("base64")}` }, body: JSON.stringify(amount ? { amount } : {}) });

    // the booth asks for a QR: an image for exactly the price, pending
    const qr = (await K("/kiosk/payments/qr", { method: "POST" })).body;
    expect(qr).toMatchObject({ amountCentavos: 15000, currency: "PHP" });
    expect(qr.qr).toMatch(/^data:image\/png;base64,/);
    expect((await K(`/kiosk/payments/${qr.paymentId}`)).body.status).toBe("PENDING");
    expect((await start(qr.paymentId)).body.error.code).toBe("PAYMENT_REQUIRED"); // not paid yet

    // a forged webhook (no real payment) changes nothing: pbooth re-checks with PayMongo
    const hook = (intent: string) => call("/payments/paymongo/webhook", { method: "POST", body: { data: { attributes: { type: "payment.paid", data: { id: "pay_x", attributes: { payment_intent_id: intent, amount: 15000 } } } } } });
    // this test's QR is the newest intent the fake has made
    const latest = async () => { for (let i = 1; ; i++) { const r = await fetch(`${pm}/v1/payment_intents/pi_${i}`, { headers: { authorization: `Basic ${Buffer.from("sk_test_mock:").toString("base64")}` } }); if (!r.ok) return `pi_${i - 1}`; } };
    const intent = await latest();
    expect((await hook(intent)).status).toBe(200);
    expect((await K(`/kiosk/payments/${qr.paymentId}`)).body.status).toBe("PENDING");

    // the guest pays; PayMongo's webhook arrives; the payment is confirmed and unlocks one session
    await pay(intent);
    expect((await hook(intent)).body).toEqual({ received: true });
    expect((await K(`/kiosk/payments/${qr.paymentId}`)).body.status).toBe("PAID");
    expect((await start(qr.paymentId)).status).toBe(201);
    expect((await start(qr.paymentId)).body.error.code).toBe("PAYMENT_REQUIRED"); // one payment, one session
    const rev = (await O(`/events/${ev.id}/revenue`)).body;
    expect(rev.qrEnabled).toBe(true);
    expect(rev.all.byMethod.QR).toEqual({ sessions: 1, amountCentavos: 15000 });

    // paid, but not the price: never unlocks a session (found by the booth's polling, no webhook)
    const short = (await K("/kiosk/payments/qr", { method: "POST" })).body;
    await pay(await latest(), 100);
    expect((await K(`/kiosk/payments/${short.paymentId}`)).body.status).toBe("FAILED");
    expect((await start(short.paymentId)).body.error.code).toBe("PAYMENT_REQUIRED");

    // another booth can't read this booth's payment
    expect((await call(`/kiosk/payments/${qr.paymentId}`, { ip: IP })).status).toBe(401);
  });
});
