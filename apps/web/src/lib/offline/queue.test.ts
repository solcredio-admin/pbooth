import { describe, expect, it } from "vitest";
import { MemoryStore, SyncQueue, type Outcome, type QueueItem } from "./queue";

const fixedClock = () => { let t = 1_000_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

describe("kiosk offline queue", () => {
  it("sends in order and removes items only once confirmed", async () => {
    const store = new MemoryStore();
    const sent: string[] = [];
    const q = new SyncQueue(store, async (i) => { sent.push(i.kind); return { done: true }; });
    await q.add("session-start", "s1", {});
    await q.add("photo", "s1", {}, new Blob(["x"]));
    await q.add("session-finish", "s1", {});
    await q.pump();
    expect(sent).toEqual(["session-start", "photo", "session-finish"]);
    expect(store.items.size).toBe(0);
    expect((await q.status()).lastSyncAt).not.toBeNull();
  });

  it("keeps everything while offline, then delivers after coming back", async () => {
    const store = new MemoryStore();
    const clock = fixedClock();
    let online = false;
    const sent: string[] = [];
    const q = new SyncQueue(store, async (i): Promise<Outcome> => { if (!online) return { retry: true }; sent.push(i.id); return { done: true }; }, clock.now);
    await q.add("session-start", "s1", {}, undefined, "a");
    await q.add("photo", "s1", {}, new Blob(["x"]), "b");
    await q.pump();
    expect(store.items.size).toBe(2);                 // nothing lost
    expect((await q.status()).online).toBe(false);
    expect(store.items.get("b")!.blob).toBeDefined(); // the photo bytes are still here
    online = true;
    await q.pump();                                   // still backing off: waits
    expect(sent).toEqual([]);
    await q.wake();                                   // e.g. the browser's "online" event
    expect(sent).toEqual(["a", "b"]);
    expect((await q.status()).pending).toBe(0);
  });

  it("survives a restart: a new queue on the same storage carries on", async () => {
    const store = new MemoryStore();
    const offline = new SyncQueue(store, async () => ({ retry: true }));
    await offline.add("photo", "s1", { photoId: "p1" }, new Blob(["x"]), "p1");
    await offline.pump(); // the kiosk "closes" here
    const sent: QueueItem[] = [];
    const restarted = new SyncQueue(store, async (i) => { sent.push(i); return { done: true }; });
    await restarted.wake();
    expect(sent.map((i) => i.body.photoId)).toEqual(["p1"]); // same photo id: the server can't duplicate it
  });

  it("gives up on hopeless items without blocking the rest", async () => {
    const store = new MemoryStore();
    const q = new SyncQueue(store, async (i): Promise<Outcome> => (i.id === "bad" ? { fatal: "Not this booth's session" } : { done: true }));
    await q.add("photo", "s1", {}, new Blob(["x"]), "bad");
    await q.add("photo", "s1", {}, new Blob(["y"]), "good");
    await q.pump();
    expect(store.items.has("good")).toBe(false);
    expect(store.items.get("bad")!.failed).toMatch(/Not this booth/);
    expect(store.items.get("bad")!.blob).toBeUndefined(); // no point keeping the bytes
    expect(await q.status()).toMatchObject({ pending: 0, failed: 1 });
  });

  it("limited retries stop eventually (a photo whose session never arrives)", async () => {
    const store = new MemoryStore();
    const clock = fixedClock();
    const q = new SyncQueue(store, async () => ({ retry: true, limited: true }), clock.now);
    await q.add("photo", "s1", {}, new Blob(["x"]), "orphan");
    for (let i = 0; i < 45; i++) { clock.advance(61_000); await q.pump(); }
    expect(store.items.get("orphan")!.failed).toBeDefined();
    expect((await q.status()).online).toBe(true); // that's not an outage
  });
});
