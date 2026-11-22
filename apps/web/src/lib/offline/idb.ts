"use client";
import type { QueueItem, QueueStore } from "./queue";

// IndexedDB: survives reloads, crashes and reboots. The browser is asked to treat it as
// persistent storage so it isn't cleared under disk pressure.
const DB = "pbooth-kiosk";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("queue", { keyPath: "id" });
      r.result.createObjectStore("meta");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export class IdbStore implements QueueStore {
  private db = open();
  constructor() { void navigator.storage?.persist?.(); }
  private async os(name: "queue" | "meta", mode: IDBTransactionMode) { return (await this.db).transaction(name, mode).objectStore(name); }
  async all() { return req((await this.os("queue", "readonly")).getAll()) as Promise<QueueItem[]>; }
  async put(i: QueueItem) { await req((await this.os("queue", "readwrite")).put(i)); }
  async remove(id: string) { await req((await this.os("queue", "readwrite")).delete(id)); }
  async getMeta(k: string) { return ((await req((await this.os("meta", "readonly")).get(k))) as string | undefined) ?? null; }
  async setMeta(k: string, v: string) { await req((await this.os("meta", "readwrite")).put(v, k)); }
}
