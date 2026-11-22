"use client";
import { kioskFetch, type KioskConfig } from "../kiosk/api";
import { IdbStore } from "./idb";
import { MemoryStore, SyncQueue, type Outcome, type QueueItem } from "./queue";

// The kiosk's single outbox, backed by IndexedDB. Sessions and photos are written here first,
// then delivered to the cloud whenever it's reachable, in order, exactly once.

const transient = (status: number) => status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function send(item: QueueItem): Promise<Outcome> {
  if (item.kind === "session-start") {
    const r = await kioskFetch("POST", "/sessions", item.body);
    if (r.ok) return { done: true };
    return transient(r.status) ? { retry: true } : { fatal: r.message };
  }
  if (item.kind === "session-finish") {
    const r = await kioskFetch("PATCH", `/sessions/${item.sessionId}/status`, item.body);
    if (r.ok) return { done: true };
    if (r.status === 404) return { retry: true, limited: true }; // its start may still be on the way
    return transient(r.status) ? { retry: true } : { fatal: r.message };
  }
  // photo: signed link (bound to size + SHA-256) → bytes straight to storage → confirm
  const a = await kioskFetch<{ alreadyUploaded: boolean; url?: string; headers?: Record<string, string> }>("POST", "/photos/upload-authorize", item.body);
  if (!a.ok) {
    if (a.code === "SESSION_UNKNOWN") return { retry: true, limited: true };
    return transient(a.status) ? { retry: true } : { fatal: a.message };
  }
  if (!a.data.alreadyUploaded) {
    try {
      const put = await fetch(a.data.url!, { method: "PUT", body: item.blob, headers: a.data.headers });
      if (!put.ok) return { retry: true, limited: put.status >= 400 && put.status < 500 };
    } catch { return { retry: true }; }
  }
  const c = await kioskFetch("POST", "/photos/upload-complete", { photoId: item.id });
  if (c.ok) return { done: true };
  if (c.code === "NOT_UPLOADED" || c.code === "INTEGRITY_FAILED") return { retry: true, limited: true };
  return transient(c.status) ? { retry: true } : { fatal: c.message };
}

let queue: SyncQueue | null = null;
let store: IdbStore | MemoryStore | null = null;

function storeOf() {
  if (!store) store = typeof indexedDB !== "undefined" ? new IdbStore() : new MemoryStore();
  return store;
}

export function kioskQueue() {
  if (!queue) {
    queue = new SyncQueue(storeOf(), send);
    // Keep delivering: on a timer, and the moment the browser says it's back online.
    setInterval(() => void queue!.pump(), 5000);
    addEventListener("online", () => void queue!.wake());
    void queue.wake(); // anything left from before a reload or crash
  }
  return queue;
}

/** A photo into the outbox. Its id is fixed now, so every retry is the same photo to the server. */
export async function enqueuePhoto(sessionId: string, blob: Blob, kind: "DESIGN" | "ORIGINAL", index: number) {
  const bytes = await blob.arrayBuffer();
  const photoId = crypto.randomUUID();
  await kioskQueue().add("photo", sessionId, {
    photoId, sessionId, kind, index, sha256: hex(await crypto.subtle.digest("SHA-256", bytes)), size: bytes.byteLength, contentType: "image/jpeg",
  }, blob, photoId);
}

// The last config this kiosk received, so it can start and keep serving guests while offline.
export async function saveConfig(boothCode: string, config: KioskConfig) {
  try { await storeOf().setMeta(`config:${boothCode}`, JSON.stringify(config)); } catch { /* storage full or blocked: not fatal */ }
}
export async function cachedConfig(boothCode: string): Promise<KioskConfig | null> {
  try { const v = await storeOf().getMeta(`config:${boothCode}`); return v ? JSON.parse(v) : null; } catch { return null; }
}
