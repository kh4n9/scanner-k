"use client";
// Thin IndexedDB persistence for scanner documents. Pages are stored as raw
// typed data + the downscaled image bytes (the object URL held in `ScanPage.src`
// is ephemeral and cannot survive a reload). Storing the image bytes keeps the
// "all on-device, no upload" promise — nothing leaves the browser.

import type { Adjust, EdgeCurves, FilterMode, PaperShape, Point, Rotate } from "./types";

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
  /** Measured bow of each paper edge (see `EdgeCurves`); absent on records
   *  written before the feature, which is the same as "all straight". */
  curves?: EdgeCurves;
  curvesEnabled?: boolean;
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
// v2: background normalization became the default (see `normalizeBackground` in
// image-pixels.ts). Scans written under v1 carry `shadow: false` *explicitly* —
// the old auto-detect heuristic set it that way — so defaulting on the read side
// could never reach them, and would also revert a user's deliberate toggle-off
// on every reload. Rewrite them once, here, instead.
const DB_VERSION = 2;
const STORE = "documents";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
        return; // fresh install — nothing stored yet to migrate
      }
      if (event.oldVersion < 2) {
        // Inside the `versionchange` transaction, so this is atomic: either
        // every document is rewritten or none is. A failure part-way cannot
        // leave the store half-migrated, and nothing is ever deleted.
        const store = req.transaction!.objectStore(STORE);
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const doc = cursor.value as StoredDoc;
          cursor.update({
            ...doc,
            pages: doc.pages.map((p) => ({ ...p, shadow: true })),
          });
          cursor.continue();
        };
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
