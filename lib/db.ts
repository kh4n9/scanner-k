"use client";
// Thin IndexedDB persistence for scanner documents. Pages are stored as raw
// typed data + the downscaled image bytes (the object URL held in `ScanPage.src`
// is ephemeral and cannot survive a reload). Storing the image bytes keeps the
// "all on-device, no upload" promise — nothing leaves the browser.

import type { Adjust, FilterMode, PaperShape, Point, Rotate } from "./types";

export type StoredPage = {
  id: string;
  name: string;
  boundary: Point[];
  paper: PaperShape;
  filter: FilterMode;
  adjust: Adjust;
  shadow?: boolean;
  sharpen?: boolean;
  rotation: Rotate;
  dewarpStrength: number;
  image: ArrayBuffer;
  mime: string;
};

export type StoredDoc = {
  id: string;
  name: string;
  updatedAt: number;
  pages: StoredPage[];
};

export type DocMeta = Pick<StoredDoc, "id" | "name" | "updatedAt"> & {
  count: number;
};

const DB_NAME = "scanner-k";
const DB_VERSION = 1;
const STORE = "documents";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // Don't cache a broken connection across calls.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function runTx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listDocuments(): Promise<DocMeta[]> {
  const all = await runTx<StoredDoc[]>("readonly", (s) => s.getAll() as IDBRequest<StoredDoc[]>);
  return all
    .map((d) => ({
      id: d.id,
      name: d.name,
      updatedAt: d.updatedAt,
      count: d.pages.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadDocument(id: string): Promise<StoredDoc | null> {
  const doc = await runTx<StoredDoc | undefined>("readonly", (s) =>
    s.get(id) as unknown as IDBRequest<StoredDoc | undefined>,
  );
  return doc ?? null;
}

export async function saveDocument(doc: StoredDoc): Promise<void> {
  await runTx<IDBValidKey>("readwrite", (s) => s.put(doc) as IDBRequest<IDBValidKey>);
}

export async function deleteDocument(id: string): Promise<void> {
  await runTx<undefined>("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}
