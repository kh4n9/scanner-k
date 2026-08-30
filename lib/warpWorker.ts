"use client";
// Client wrapper around the image Web Worker. Responsible for creating the
// worker, pairing requests/responses, and surfacing failures so callers can fall
// back to the main-thread path.
import type { Adjust, FilterMode } from "./types";

type WarpRequest = {
  type: "warp";
  src: ArrayBuffer;
  srcW: number;
  srcH: number;
  h: number[];
  outW: number;
  outH: number;
  logicalW: number;
  logicalH: number;
  filter: FilterMode;
  adjust?: Adjust;
  shadow: boolean;
  sharpen: boolean;
};

type WarpResponse = { id: number; out: ArrayBuffer };

let worker: Worker | null = null;
let workAttempted = false;
let counter = 0;
const pending = new Map<number, { resolve: (r: Uint8ClampedArray<ArrayBuffer>) => void; reject: (e: unknown) => void }>();

function rejectAll(reason: unknown) {
  for (const [, p] of pending) p.reject(reason);
  pending.clear();
}

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  if (workAttempted) return null;
  workAttempted = true;
  try {
    worker = new Worker(new URL("./image.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<WarpResponse>) => {
      const { id, out } = e.data;
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        p.resolve(new Uint8ClampedArray(out));
      }
    };
    worker.onerror = () => {
      rejectAll(new Error("image worker error"));
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

/** Run a warp+filter in the worker. Rejects if the worker is unavailable, so the
 *  caller can transparently fall back to the main-thread implementation. */
export function warpInWorker(req: WarpRequest): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("worker unavailable"));
  const id = ++counter;
  return new Promise<Uint8ClampedArray<ArrayBuffer>>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage({ ...req, id } satisfies WarpRequest & { id: number }, [req.src]);
    } catch (e) {
      pending.delete(id);
      reject(e);
    }
  });
}
