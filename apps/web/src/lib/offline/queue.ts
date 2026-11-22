// The kiosk's durable outbox. Every session record and photo goes in here first and leaves only
// once the cloud has confirmed it, so an outage, a reload or a crash loses nothing.
// Pure logic: storage and sending are injected (IndexedDB + fetch in the kiosk, memory in tests).

export type ItemKind = "session-start" | "session-finish" | "photo";
export interface QueueItem {
  id: string;            // unique and stable: retries reuse it, so the server sees one item, not many
  seq: number;           // order of creation; items are sent strictly in this order
  kind: ItemKind;
  sessionId: string;
  body: Record<string, unknown>;
  blob?: Blob;           // photo bytes (IndexedDB stores Blobs natively)
  attempts: number;
  nextAt: number;        // don't try again before this time (back-off)
  failed?: string;       // gave up: kept so the operator/admin can see it
}

export interface QueueStore {
  all(): Promise<QueueItem[]>;
  put(item: QueueItem): Promise<void>;
  remove(id: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

/** What happened when sending: done (remove it), retry later, or give up with a reason. */
export type Outcome = { done: true } | { retry: true; limited?: boolean } | { fatal: string };
export type Sender = (item: QueueItem) => Promise<Outcome>;

export interface QueueStatus { pending: number; failed: number; lastSyncAt: string | null; online: boolean }

const MAX_BACKOFF = 60_000;
const LIMITED_TRIES = 40; // for "retry, but not forever" (e.g. a photo whose session never arrives)

export class SyncQueue {
  private current: Promise<void> | null = null;
  private again = false;
  private seq = 0;
  private online = true;
  private listeners = new Set<() => void>();

  constructor(private readonly store: QueueStore, private readonly send: Sender, private readonly now: () => number = Date.now) {}

  onChange(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { this.listeners.forEach((f) => f()); }

  async add(kind: ItemKind, sessionId: string, body: Record<string, unknown>, blob?: Blob, id: string = crypto.randomUUID()) {
    const seq = Math.max(this.now() * 1000, this.seq + 1);
    this.seq = seq;
    await this.store.put({ id, seq, kind, sessionId, body, blob, attempts: 0, nextAt: 0 });
    this.changed();
    void this.pump();
  }

  /**
   * Sends waiting items oldest first. Stops at the first item that has to wait, so a session's
   * start always reaches the server before its photos and finish. Safe to call any time.
   */
  pump(): Promise<void> {
    // One run at a time; a call during a run joins it, and anything added meanwhile is picked up
    // before the run ends.
    if (this.current) { this.again = true; return this.current; }
    this.current = (async () => {
      try {
        do { this.again = false; await this.runOnce(); } while (this.again);
      } finally { this.current = null; }
    })();
    return this.current;
  }

  private async runOnce() {
    {
      const items = (await this.store.all()).filter((i) => !i.failed).sort((a, b) => a.seq - b.seq);
      for (const item of items) {
        if (item.nextAt > this.now()) break;
        let outcome: Outcome;
        try { outcome = await this.send(item); } catch { outcome = { retry: true }; }
        if ("done" in outcome) {
          await this.store.remove(item.id);
          await this.store.setMeta("lastSyncAt", new Date(this.now()).toISOString());
          this.online = true;
        } else if ("fatal" in outcome || (outcome.limited && item.attempts + 1 >= LIMITED_TRIES)) {
          await this.store.put({ ...item, attempts: item.attempts + 1, failed: "fatal" in outcome ? outcome.fatal : "Gave up after many tries", blob: undefined });
          this.online = true;
        } else {
          const attempts = item.attempts + 1;
          await this.store.put({ ...item, attempts, nextAt: this.now() + Math.min(MAX_BACKOFF, 1000 * 2 ** Math.min(attempts, 6)) });
          if (!outcome.limited) this.online = false;
          this.changed();
          break;
        }
        this.changed();
      }
    }
  }

  /** Try everything again now (e.g. the browser just came back online). */
  async wake() {
    for (const i of await this.store.all()) if (!i.failed && i.nextAt > this.now()) await this.store.put({ ...i, nextAt: 0 });
    await this.pump();
  }

  async status(): Promise<QueueStatus> {
    const items = await this.store.all();
    return { pending: items.filter((i) => !i.failed).length, failed: items.filter((i) => i.failed).length, lastSyncAt: await this.store.getMeta("lastSyncAt"), online: this.online };
  }

  /** Photos of this session still on their way. */
  async pendingPhotos(sessionId: string) {
    return (await this.store.all()).filter((i) => i.sessionId === sessionId && i.kind === "photo" && !i.failed).length;
  }
}

/** In-memory store (tests, or browsers without IndexedDB). */
export class MemoryStore implements QueueStore {
  items = new Map<string, QueueItem>();
  meta = new Map<string, string>();
  async all() { return [...this.items.values()]; }
  async put(i: QueueItem) { this.items.set(i.id, i); }
  async remove(id: string) { this.items.delete(id); }
  async getMeta(k: string) { return this.meta.get(k) ?? null; }
  async setMeta(k: string, v: string) { this.meta.set(k, v); }
}
