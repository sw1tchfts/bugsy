"use client";

// IndexedDB store for the technician app: the cached route per day, the change queue and photo blobs. Everything is
// written here before a screen moves on, so a dead battery or no signal never loses a stop.
import type { QueuedChange, RoutePayload } from "@/lib/tech/route-types";

const DB_NAME = "bugsy-tech";
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("routes")) db.createObjectStore("routes", { keyPath: "key" });
      if (!db.objectStoreNames.contains("changes")) db.createObjectStore("changes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = fn(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export const techStore = {
  async saveRoute(tenantId: string, route: RoutePayload): Promise<void> {
    await run("routes", "readwrite", (s) => s.put({ key: `${tenantId}:${route.date}`, route }));
  },
  async loadRoute(tenantId: string, date: string): Promise<RoutePayload | null> {
    const row = await run<{ key: string; route: RoutePayload } | undefined>("routes", "readonly", (s) => s.get(`${tenantId}:${date}`));
    return row?.route ?? null;
  },
  async listChanges(): Promise<QueuedChange[]> {
    return run<QueuedChange[]>("changes", "readonly", (s) => s.getAll());
  },
  async putChange(change: QueuedChange): Promise<void> {
    await run("changes", "readwrite", (s) => s.put(change));
  },
  async putChanges(changes: readonly QueuedChange[]): Promise<void> {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("changes", "readwrite");
      const store = tx.objectStore("changes");
      for (const c of changes) store.put(c);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  },
  async deleteChange(id: string): Promise<void> {
    await run("changes", "readwrite", (s) => s.delete(id));
  },
  async clearSynced(olderThanIso: string): Promise<void> {
    const all = await this.listChanges();
    for (const c of all) if (c.status === "synced" && c.created_at < olderThanIso) await this.deleteChange(c.id);
  },
  async putBlob(id: string, dataUrl: string): Promise<void> {
    await run("blobs", "readwrite", (s) => s.put({ id, dataUrl }));
  },
  async getBlob(id: string): Promise<string | null> {
    const row = await run<{ id: string; dataUrl: string } | undefined>("blobs", "readonly", (s) => s.get(id));
    return row?.dataUrl ?? null;
  },
};

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
