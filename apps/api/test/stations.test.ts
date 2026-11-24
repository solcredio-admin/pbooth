import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, inject, it } from "vitest";
import { call as rawCall, login, newEvent, type CallInit } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;
const s3 = inject("s3");
const IP = "10.0.50.1";
const anyIp = () => `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`; // many computers
const call = (path: string, init: CallInit = {}) => rawCall(path, { ip: anyIp(), ...init });
let owner: Promise<string> | undefined;
const O = async (path: string, init: CallInit = {}) => call(path, { cookie: await (owner ??= login(IP)), ...init });
const post = (path: string, body?: unknown) => O(path, { method: "POST", body });
const computer = (identifier: string) => ({ identifier, hostname: identifier, os: "Linux", agentVersion: "0.5.0" });

async function booth(kind: "MANAGED" | "SELF_SERVICE" = "MANAGED") {
  const b = (await post("/booths", { name: `Booth ${randomUUID().slice(0, 8)}` })).body;
  const ev = (await post("/events", { ...newEvent, name: `Ev ${b.code}`, kind, config: { printEnabled: true, printCopies: 2, layout: "landscape" }, ...(kind === "SELF_SERVICE" ? { priceCentavos: 15000 } : {}) })).body;
  await post(`/events/${ev.id}/booths`, { boothId: b.id });
  await post(`/events/${ev.id}/activate`);
  const { code } = (await post(`/booths/${b.id}/kiosk-code`)).body;
  const kiosk = (await call("/kiosk/pair", { method: "POST", body: { boothCode: b.code, code } })).setCookie!.split(";")[0];
  const K = (path: string, init: CallInit = {}) => call(path, { cookie: kiosk, ...init });
  /** A finished session whose design is uploaded. */
  const session = async (extra: object = {}) => {
    const id = randomUUID(), photoId = randomUUID();
    expect((await K("/sessions", { method: "POST", body: { id, galleryToken: randomBytes(32).toString("base64url"), ...extra } })).status).toBe(201);
    const file = await sharp({ create: { width: 180, height: 120, channels: 3, background: "#345" } }).jpeg().toBuffer();
    const sha256 = createHash("sha256").update(file).digest("hex");
    const a = (await K("/photos/upload-authorize", { method: "POST", body: { photoId, sessionId: id, kind: "DESIGN", index: 0, sha256, size: file.length, contentType: "image/jpeg" } })).body;
    expect((await fetch(a.url, { method: "PUT", body: file, headers: a.headers })).status).toBe(200);
    const done = () => K("/photos/upload-complete", { method: "POST", body: { photoId } });
    const print = () => K("/kiosk/prints", { method: "POST", body: { sessionId: id, photoId } });
    return { id, photoId, sha256, done, print, status: async () => (await K(`/kiosk/prints/${id}`)).body };
  };
  const printed = async () => { const s = await session(); await s.done(); expect((await s.print()).body.status).toBe("WAITING"); return s; };
  return { ...b, ev, K, session, printed, rotate: (...ids: string[]) => O(`/booths/${b.id}/stations`, { method: "PUT", body: { stationIds: ids, mode: "ROTATE" } }), link: (...ids: string[]) => O(`/booths/${b.id}/stations`, { method: "PUT", body: { stationIds: ids } }), config: async () => (await K(`/kiosk/config?booth=${b.code}`)).body };
}

async function station(name = "Station") {
  const s = (await post("/stations", { name: `${name} ${randomUUID().slice(0, 8)}` })).body;
  const enroll = async (id = `pc-${s.code}`, stations = true) => {
    const { code } = (await post(`/stations/${s.id}/enrollment-code`)).body;
    return call("/devices/enroll", { method: "POST", ip: `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, body: { code, device: computer(id), stations } });
  };
  let token = (await enroll()).body.token as string;
  const poll = async (ready = true) => (await call("/station/poll", { method: "POST", token, body: { ready, error: ready ? null : "Paper out", printers: [{ name: "DNP", isDefault: true }] } })).body as { station: { paperSize: string }; jobs: { id: string; attempt: number; url: string; sha256: string; copies: number }[] };
  const report = (id: string, status: string, attempt = 1, safe = false) => call(`/station/jobs/${id}`, { method: "POST", token, body: { attempt, status, safe } });
  /** Takes the next one, prints it, returns its id. */
  const next = async () => { const [j] = (await poll()).jobs; if (!j) return null; expect((await report(j.id, "PRINTING", j.attempt)).status).toBe(200); expect((await report(j.id, "DONE", j.attempt)).status).toBe(200); return j.id; };
  return { ...s, enroll, poll, next, report, use: (t: string) => { token = t; }, ids: async (ready = true) => (await poll(ready)).jobs.map((j) => j.id) };
}

describe.skipIf(!url)("stations: setup", () => {
  it("a station code makes a station's computer, only with an agent that can run one; signing out cuts it off at once", async () => {
    const s = await station();
    expect((await s.enroll("old", false)).body.error.code).toBe("AGENT_TOO_OLD");
    expect((await s.poll()).station.paperSize).toBe("4x6");
    expect((await O(`/stations/${s.id}`)).body).toMatchObject({ online: true, ready: true, computer: { hostname: `pc-${s.code}` }, printers: [{ name: "DNP", isDefault: true }] });
    await s.poll(false);
    expect((await O(`/stations/${s.id}`)).body).toMatchObject({ online: true, ready: false, lastError: "Paper out" });
    expect((await O(`/stations/${s.id}`, { method: "PATCH", body: { paperSize: "5x7", printerName: "DNP" } })).body).toMatchObject({ paperSize: "5x7", printerName: "DNP" });
    await post(`/stations/${s.id}/sign-out`);
    expect((await call("/station/poll", { method: "POST", token: "pbd_" + "x".repeat(43), body: { ready: true } })).status).toBe(401);
    expect((await s.poll() as unknown as { error: { code: string } }).error.code).toBe("STATION_UNAUTHORIZED");
    expect((await post(`/stations/${s.id}/delete`, { confirmName: "nope" })).status).toBe(400);
    expect((await post(`/stations/${s.id}/delete`, { confirmName: s.name })).status).toBe(200);
  });

  it("one computer can be a booth's agent and its station: the kiosk then prints directly, with the station's settings", async () => {
    const b = await booth(), s = await station();
    const { code } = (await post(`/booths/${b.id}/enrollment-code`)).body;
    const agent = (await call("/devices/enroll", { method: "POST", body: { code, device: computer("same-pc") } })).body;
    await b.link(s.id);
    expect((await b.config()).printing).toEqual({ direct: false, stations: 1, here: null });
    expect((await b.config()).printer.enabled).toBe(false);
    s.use((await s.enroll("same-pc")).body.token);
    await O(`/stations/${s.id}`, { method: "PATCH", body: { paperSize: "5x7" } });
    const c = await b.config();
    expect(c.printing).toEqual({ direct: true, stations: 1, here: s.name });
    expect(c.printer).toMatchObject({ enabled: true, paperSize: "5x7" }); // older agents keep printing with this
    expect((await call("/devices/config", { token: agent.token })).body.printer.enabled).toBe(true);
    // with a backup, or shared with another booth, prints go through the line (direct stays the no-internet fallback)
    const other = await station();
    await b.link(s.id, other.id);
    expect((await b.config()).printing).toEqual({ direct: false, stations: 2, here: s.name });
    await O(`/stations/${other.id}`, { method: "PATCH", body: { enabled: false } });
    expect((await b.config()).printing).toMatchObject({ direct: true, stations: 1 });
    const c2 = await booth();
    await c2.link(s.id);
    expect((await b.config()).printing).toMatchObject({ direct: false, here: s.name });
    expect((await O(`/booths/${b.id}/stations`, { method: "PUT", body: { stationIds: [s.id, s.id] } })).status).toBe(400);
  });
});

describe.skipIf(!url || !s3)("stations: printing", () => {
  it("a print needs its uploaded photo and a linked station; asking twice is one print", async () => {
    const b = await booth(), s = await station();
    const one = await b.session();
    expect((await one.print()).body.error.code).toBe("PHOTO_UNKNOWN"); // still uploading: the kiosk retries
    await one.done();
    expect((await one.print()).body.error.code).toBe("NO_STATIONS");
    await b.link(s.id);
    await Promise.all([one.print(), one.print(), one.print()]);
    expect(await one.status()).toEqual({ id: one.id, status: "WAITING", station: null, ahead: 0 });
    const [j] = (await s.poll()).jobs;
    expect(j).toMatchObject({ id: one.id, attempt: 1, copies: 2, sha256: one.sha256 });
    expect(createHash("sha256").update(Buffer.from(await (await fetch(j.url)).arrayBuffer())).digest("hex")).toBe(one.sha256);
    expect(await one.status()).toMatchObject({ status: "CLAIMED", station: s.name });
    expect(await s.ids()).toEqual([one.id]); // a lost answer: it simply asks again
    expect((await s.report(one.id, "DONE")).status).toBe(200);
    expect((await one.print()).body.status).toBe("DONE"); // a late retry from the kiosk prints nothing more
    expect(await s.ids()).toEqual([]);
    expect((await (await booth()).K(`/kiosk/prints/${one.id}`)).status).toBe(404);
  }, 30_000);

  it("fixed list: a backup steps in when the main printer can't print, not when it's busy", async () => {
    const a = await station("Main"), z = await station("Backup");
    const b = await booth();
    await b.link(a.id, z.id);
    await a.ids(); await z.ids();
    const one = await b.printed(), two = await b.printed();
    expect(await z.ids()).toEqual([]);       // Main can print: it's Main's
    expect(await a.ids()).toEqual([one.id]);
    await a.report(one.id, "PRINTING");
    expect(await z.ids()).toEqual([]);       // Main is only busy: two waits for it
    expect(await two.status()).toMatchObject({ status: "WAITING", ahead: 1 });
    await a.report(one.id, "DONE");
    expect(await a.next()).toBe(two.id);
    const three = await b.printed();
    await a.ids(false);                      // Main is out of paper
    expect(await z.ids()).toEqual([three.id]);
    expect(await a.ids()).toEqual([]);       // Main is back, but Backup has it
    expect((await a.report(three.id, "DONE")).body.error.code).toBe("NOT_YOURS");
    expect(await z.next()).toBe(three.id);
  }, 30_000);

  it("the main printer took it but couldn't print: handed back, the backup catches it; once it may be printing, nobody does", async () => {
    const a = await station("Main"), z = await station("Backup");
    const b = await booth();
    await b.link(a.id, z.id);
    await z.ids();
    const one = await b.printed();
    expect(await a.ids()).toEqual([one.id]);
    await a.report(one.id, "PRINTING");
    await a.report(one.id, "FAILED", 1, true); // the agent is sure nothing came out
    expect(await a.ids()).toEqual([]);
    expect((await z.poll()).jobs).toMatchObject([{ id: one.id, attempt: 2 }]);
    expect((await a.report(one.id, "PRINTING")).status).toBe(409); // Main's old try is over
    expect(await z.next()).toBe(one.id);

    const two = await b.printed();
    expect(await a.ids()).toEqual([two.id]); // …and vanishes before asking to print
    const at = Date.now();
    let got: string[] = [];
    while (!got.length && Date.now() - at < 14_000) { got = await z.ids(); await new Promise((r) => setTimeout(r, 300)); }
    expect(got).toEqual([two.id]);
    await z.report(two.id, "DONE", 2);

    const three = await b.printed();
    expect(await a.ids()).toEqual([three.id]);
    await a.report(three.id, "PRINTING");    // …and vanishes while printing
    for (const end = Date.now() + 13_000; Date.now() < end; await new Promise((r) => setTimeout(r, 1000))) expect(await z.ids()).toEqual([]);
    expect(await three.status()).toMatchObject({ status: "PRINTING", station: a.name });
    const four = await b.printed();
    expect(await z.next()).toBe(four.id);    // what's behind it doesn't wait for it
    expect(await a.ids()).toEqual([three.id]); // back: it picks up where it was
    await a.report(three.id, "DONE");
  }, 60_000);

  it("rotate: a booth's stations take turns, and one that's off is skipped", async () => {
    const st = [await station("R1"), await station("R2"), await station("R3")];
    const b = await booth();
    await b.rotate(...st.map((s) => s.id));
    expect((await O(`/booths/${b.id}`)).body.printMode).toBe("ROTATE");
    for (const s of st) await s.poll();
    const turn = async () => { const p = await b.printed(); for (const s of [...st, ...st]) { const id = await s.next(); if (id) { expect(id).toBe(p.id); return s.name; } } throw new Error("nobody took it"); };
    const six = [await turn(), await turn(), await turn(), await turn(), await turn(), await turn()];
    expect(new Set(six.slice(0, 3)).size).toBe(3);
    expect(six.slice(3)).toEqual(six.slice(0, 3));
    await st.find((s) => s.name === six[0])!.poll(false);
    const p = await b.printed();
    const takers = [];
    for (const s of st.filter((x) => x.name !== six[0])) takers.push(await s.next());
    expect(takers.filter(Boolean)).toEqual([p.id]);
  }, 60_000);

  it("many booths, one printer: one line, oldest first, every print exactly once, however often it asks", async () => {
    const a = await station("Shared");
    const booths = [await booth(), await booth(), await booth(), await booth()];
    for (const b of booths) await b.link(a.id);
    const sent: string[] = [];
    for (let i = 0; i < 3; i++) for (const b of booths) sent.push((await b.printed()).id);
    const done: string[] = [];
    for (let n = 0; done.length < sent.length && n < 60; n++) {
      // answers lost, asked again, several at once: it never holds two
      const polls = await Promise.all([a.poll(), a.poll(), a.poll()]);
      const held = new Set(polls.flatMap((p) => p.jobs.map((j) => j.id)));
      expect(held.size).toBe(1);
      const [j] = (await a.poll()).jobs;
      const asks = await Promise.all([a.report(j.id, "PRINTING", j.attempt), a.report(j.id, "PRINTING", j.attempt)]);
      expect(asks.map((x) => x.status).sort()).toEqual([200, 409]); // one yes
      await a.report(j.id, "DONE", j.attempt);
      done.push(j.id);
    }
    expect(done).toEqual(sent);
  }, 60_000);

  it("a print that can't go through doesn't hold up the line: it waits its turn again, then staff see it", async () => {
    const a = await station("Shared");
    const b = await booth(), c = await booth();
    await b.link(a.id); await c.link(a.id);
    const bad = await b.printed(), good = await c.printed();
    expect(await a.ids()).toEqual([bad.id]);
    await a.report(bad.id, "FAILED", 1, true);
    expect(await a.next()).toBe(good.id); // the next booth's print goes through meanwhile
    expect(await bad.status()).toMatchObject({ status: "WAITING" });
    // a deleted photo is dropped from the line at once
    const gone = await c.printed();
    expect((await O(`/photos/${gone.photoId}`, { method: "DELETE" })).status).toBeLessThan(300);
    await a.ids();
    expect((await gone.status()).status).toBe("FAILED");
    const last = await c.printed();
    expect(await a.next()).toBe(last.id);
  }, 30_000);

  it("staff retry a failed print or send it elsewhere; moving one that may be printing needs a second yes", async () => {
    const a = await station("A"), z = await station("Z");
    const b = await booth();
    await b.link(a.id);
    const one = await b.printed();
    expect(await a.ids()).toEqual([one.id]);
    expect((await post(`/stations/jobs/${one.id}/retry`)).body.error.code).toBe("NOT_RETRYABLE");
    await a.report(one.id, "PRINTING"); await a.report(one.id, "FAILED");
    expect((await post(`/stations/jobs/${one.id}/retry`)).status).toBe(200);
    expect((await a.poll()).jobs).toMatchObject([{ id: one.id, attempt: 2 }]);
    expect((await a.report(one.id, "DONE", 1)).status).toBe(409); // news about the first try is ignored
    await a.report(one.id, "PRINTING", 2);
    expect((await post(`/stations/jobs/${one.id}/move`, { stationId: z.id })).body.error.code).toBe("MAY_PRINT_TWICE");
    expect((await post(`/stations/jobs/${one.id}/move`, { stationId: z.id, confirm: true })).status).toBe(200);
    expect(await a.ids()).toEqual([]); // sent to Z: A may not take it back, even though it's free
    expect((await z.poll()).jobs).toMatchObject([{ id: one.id, attempt: 3 }]);
    await z.report(one.id, "DONE", 3);
    expect((await post(`/stations/jobs/${one.id}/move`, { stationId: a.id })).body.error.code).toBe("ALREADY_PRINTED");
    expect((await O(`/stations/jobs?status=done&stationId=${z.id}`)).body.items).toMatchObject([{ id: one.id, status: "DONE" }]);
  }, 30_000);

  it("a replaced computer never prints what the old one had taken", async () => {
    const s = await station(), b = await booth();
    await b.link(s.id);
    const one = await b.printed();
    expect(await s.ids()).toEqual([one.id]);
    s.use((await s.enroll("new-pc")).body.token);
    expect(await s.ids()).toEqual([]);
    expect((await one.status()).status).toBe("FAILED");
  }, 30_000);

  it("a print nobody takes expires; a paid one is flagged for a refund, once, and Telegram hears about a failed print", async () => {
    const s = await station(), b = await booth("SELF_SERVICE");
    await b.link(s.id);
    const pay = async () => { const { codes } = (await post(`/events/${b.ev.id}/vouchers`, { kind: "ONE_TIME", count: 1 })).body; return (await b.K("/kiosk/redeem", { method: "POST", body: { code: codes[0] } })).body.paymentId as string; };
    const bad = await b.session({ paymentId: await pay() });
    await bad.done(); await bad.print();
    expect(await s.ids()).toEqual([bad.id]);
    await s.report(bad.id, "FAILED");
    await s.ids(false);
    const one = await b.session({ paymentId: await pay() });
    await one.done(); await one.print();
    for (let i = 0; i < 80 && (await one.status()).status !== "EXPIRED"; i++) await new Promise((r) => setTimeout(r, 250));
    expect((await one.status()).status).toBe("EXPIRED");
    await new Promise((r) => setTimeout(r, 1500));
    expect((await O(`/refunds?eventId=${b.ev.id}&status=open`)).body.items).toMatchObject([{ reason: "NO_PRINT" }]);
    expect(await s.ids()).toEqual([]); // too late: never printed by surprise
    const recent = (await O("/alerts")).body.recent as { key: string; text: string }[];
    expect(recent.find((a) => a.key === `print:${b.id}`)?.text).toContain(`a print failed at ${s.name}`);
    // staff can still send it to a station
    expect((await post(`/stations/jobs/${one.id}/move`, { stationId: s.id })).status).toBe(200);
    expect(await s.ids()).toEqual([one.id]);
  }, 40_000);
});
