// Web Worker that runs the heavy perspective warp + filter pipeline off the main
// thread. It only touches raw RGBA buffers (no DOM/canvas), so it works in a
// plain worker. Typed via a local scope cast so it type-checks alongside the
// DOM lib (no `lib=webworker` conflict).
import { applyFilterRgba, buildEdgeDeviations, warpMeshRgba, warpRgba } from "./image-pixels";
import type { Adjust, FilterMode } from "./types";

type WarpRequest = {
  id: number;
  type: "warp";
  src: ArrayBuffer;
  srcW: number;
  srcH: number;
  h: number[];
  /** Four edge polylines, packed as `[count, x,y, ...]` per edge in
   *  [top, right, bottom, left] order. Present ⇒ mesh warp. */
  edges?: Float32Array;
  outW: number;
  outH: number;
  logicalW: number;
  logicalH: number;
  filter: FilterMode;
  adjust?: Adjust;
  shadow: boolean;
  /** Unsharp-mask amount; 0 leaves the pixels alone. */
  sharpen: number;
};

type WorkerScope = {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const scope = self as unknown as WorkerScope;

function handleWarp(req: WarpRequest) {
  const src = new Uint8ClampedArray(req.src);
  const out = req.edges
    ? warpMeshRgba(
        src,
        req.srcW,
        req.srcH,
        req.h,
        buildEdgeDeviations(req.h, req.edges, req.outW, req.outH, req.logicalW, req.logicalH),
        req.outW,
        req.outH,
        req.logicalW,
        req.logicalH,
      )
    : warpRgba(
        src,
        req.srcW,
        req.srcH,
        req.h,
        req.outW,
        req.outH,
        req.logicalW,
        req.logicalH,
      );
  applyFilterRgba(out, req.outW, req.outH, req.filter, req.adjust, {
    shadow: req.shadow,
    sharpen: req.sharpen,
  });
  // Transfer the finished buffer back (zero-copy).
  scope.postMessage({ id: req.id, out: out.buffer }, [out.buffer]);
}

scope.onmessage = (e: MessageEvent) => {
  const req = e.data as WarpRequest;
  switch (req.type) {
    case "warp":
      handleWarp(req);
      break;
  }
};
