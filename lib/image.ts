import { applyFilterRgba, autoAdjust, isNeutralFilter } from "./image-pixels";
import type { Adjust, FilterMode, PaperShape, Point, Rotate } from "./types";
import { warpInWorker } from "./warpWorker";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Không thể đọc hình ảnh."));
    image.src = src;
  });
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const FULL_BOUNDARY: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const MM_TO_PT = 72 / 25.4;

// Draw the filtered result back onto the canvas. The pixel work itself lives in
// `image-pixels.ts` so the main-thread and Web-Worker paths can never drift
// apart, and so this function never needs its own copy of the pipeline.
export function applyFilter(
  canvas: HTMLCanvasElement,
  filter: FilterMode,
  adjust?: Adjust,
  opts?: { shadow?: boolean; sharpen?: boolean },
) {
  // Skip the buffer round-trip entirely when the pipeline would be a no-op —
  // the common case while the user drags a slider.
  if (isNeutralFilter(filter, adjust, opts)) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  if (applyFilterRgba(imageData.data, width, height, filter, adjust, opts)) {
    ctx.putImageData(imageData, 0, 0);
  }
}

export async function computeAutoAdjust(
  src: string,
): Promise<{ adjust: Adjust; shadow: boolean }> {
  const image = await loadImage(src);
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const maxSide = 220;
  const scale = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const lum = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    lum[p] = l;
    sum += l;
  }
  const mean = sum / lum.length;

  const sorted = Float32Array.from(lum).sort();
  const pct = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  const p05 = pct(0.05);
  const p95 = pct(0.95);

  // Always flatten the background. On an even, already-white page the
  // normalization is a near no-op (every gain sits at ~1), while a colour cast
  // or an illumination falloff — exactly the case the old `p95 > 150 && p50 <
  // p95 * 0.86` shadow heuristic let through, leaving the paper cream or grey —
  // now gets corrected. The per-page toggle in the editor is the opt-out.
  const shadow = true;

  // The parameter maths lives in the DOM-free pixel module so the harness can
  // test the exact combination that ships.
  return { adjust: autoAdjust(mean, p05, p95), shadow };
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(bx - ax, by - ay);
}

function affineTransform(
  s0: Point,
  s1: Point,
  s2: Point,
  t0: Point,
  t1: Point,
  t2: Point,
): [number, number, number, number, number, number] | null {
  const x0 = s0.x,
    y0 = s0.y,
    x1 = s1.x,
    y1 = s1.y,
    x2 = s2.x,
    y2 = s2.y;
  const ux0 = t0.x,
    uy0 = t0.y,
    ux1 = t1.x,
    uy1 = t1.y,
    ux2 = t2.x,
    uy2 = t2.y;
  const denom = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (denom === 0) return null;
  const a = (ux0 * (y1 - y2) + ux1 * (y2 - y0) + ux2 * (y0 - y1)) / denom;
  const b = (uy0 * (y1 - y2) + uy1 * (y2 - y0) + uy2 * (y0 - y1)) / denom;
  const c = (ux0 * (x2 - x1) + ux1 * (x0 - x2) + ux2 * (x1 - x0)) / denom;
  const d = (uy0 * (x2 - x1) + uy1 * (x0 - x2) + uy2 * (x1 - x0)) / denom;
  const e = (ux0 * (x1 * y2 - x2 * y1) + ux1 * (x2 * y0 - x0 * y2) + ux2 * (x0 * y1 - x1 * y0)) / denom;
  const f = (uy0 * (x1 * y2 - x2 * y1) + uy1 * (x2 * y0 - x0 * y2) + uy2 * (x0 * y1 - x1 * y0)) / denom;
  return [a, b, c, d, e, f];
}

function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 1) return pts;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const pt of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0)
      lower.pop();
    lower.push(pt);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const pt = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0)
      upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function minAreaRect(hull: Point[]): Point[] {
  if (hull.length < 3) return [];
  let best = Infinity;
  let bestBox: Point[] | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const len = Math.hypot(ux, uy) || 1;
    const uxN = ux / len;
    const uyN = uy / len;
    const vx = -uyN;
    const vy = uxN;
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const pt of hull) {
      const u = pt.x * uxN + pt.y * uyN;
      const v = pt.x * vx + pt.y * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best) {
      best = area;
      bestBox = [
        { x: minU * uxN + minV * vx, y: minU * uyN + minV * vy },
        { x: maxU * uxN + minV * vx, y: maxU * uyN + minV * vy },
        { x: maxU * uxN + maxV * vx, y: maxU * uyN + maxV * vy },
        { x: minU * uxN + maxV * vx, y: minU * uyN + maxV * vy },
      ];
    }
  }
  return bestBox ?? [];
}

// 4-connectivity neighbours clamped to the image bounds. Using the flat index
// directly (±1 / ±w) would wrap across the left/right edge and incorrectly merge
// rows, corrupting the connected components that touch the border — carry the
// column/row position instead so each neighbour stays inside the frame.
function componentNeighbors(idx: number, w: number, h: number): number[] {
  const x = idx % w;
  const y = (idx / w) | 0;
  const out: number[] = [];
  if (x > 0) out.push(idx - 1);
  if (x < w - 1) out.push(idx + 1);
  if (y > 0) out.push(idx - w);
  if (y < h - 1) out.push(idx + w);
  return out;
}

type ComponentInfo = {
  pixels: Point[];
  size: number;
  areaFrac: number;
  score: number;
};

function componentInfo(mask: Uint8Array, w: number, h: number): ComponentInfo | null {
  const visited = new Uint8Array(w * h);
  let bestStart = -1;
  let bestSize = 0;
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start]) continue;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let size = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      size++;
      for (const n of componentNeighbors(idx, w, h)) {
        if (mask[n] === 0 || visited[n]) continue;
        visited[n] = 1;
        stack.push(n);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestStart = start;
    }
  }
  if (bestSize === 0) return null;
  const pixels: Point[] = [];
  const seen = new Uint8Array(w * h);
  stack.length = 0;
  stack.push(bestStart);
  seen[bestStart] = 1;
  while (stack.length) {
    const idx = stack.pop()!;
    pixels.push({ x: idx % w, y: (idx / w) | 0 });
    for (const n of componentNeighbors(idx, w, h)) {
      if (mask[n] === 0 || seen[n]) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  const areaFrac = bestSize / (w * h);
  let coverFrac = 0;
  const hull = convexHull(pixels);
  if (hull.length >= 3) {
    const box = minAreaRect(hull);
    if (box.length === 4) {
      const xs = box.map((p) => p.x);
      const ys = box.map((p) => p.y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      coverFrac = (width / w) * (height / h);
    }
  }
  return {
    pixels,
    size: bestSize,
    areaFrac,
    score: areaFrac * (1 - coverFrac),
  };
}

async function getDocComponent(src: string, maxSide: number) {
  const image = await loadImage(src);
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const lum = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    lum[p] = l;
    sum += l;
  }
  const mean = sum / lum.length;

  const bright = new Uint8Array(w * h);
  const dark = new Uint8Array(w * h);
  for (let p = 0; p < lum.length; p++) {
    bright[p] = lum[p] >= mean ? 1 : 0;
    dark[p] = lum[p] < mean ? 1 : 0;
  }

  const best = [componentInfo(bright, w, h), componentInfo(dark, w, h)]
    .filter((info): info is ComponentInfo => !!info && info.size >= w * h * 0.03)
    .sort((a, b) => b.score - a.score)[0];

  if (!best) return { pixels: null as Point[] | null, w, h };
  return { pixels: best.pixels, w, h };
}

export async function detectDocBoundary(src: string): Promise<Point[]> {
  const { pixels, w, h } = await getDocComponent(src, 360);
  if (!pixels || pixels.length < 4) return FULL_BOUNDARY.slice();

  const hull = convexHull(pixels);
  if (hull.length < 3) return FULL_BOUNDARY.slice();

  // Return the 4 clean corners (tl/tr/br/bl) — automatic, no scattered points.
  const extremes = {
    tl: hull[0],
    tr: hull[0],
    br: hull[0],
    bl: hull[0],
  };
  let minSum = Infinity,
    maxSum = -Infinity,
    minDiff = Infinity,
    maxDiff = -Infinity;
  for (const pt of hull) {
    const s = pt.x + pt.y;
    const dd = pt.x - pt.y;
    if (s < minSum) {
      minSum = s;
      extremes.tl = pt;
    }
    if (s > maxSum) {
      maxSum = s;
      extremes.br = pt;
    }
    if (dd < minDiff) {
      minDiff = dd;
      extremes.bl = pt;
    }
    if (dd > maxDiff) {
      maxDiff = dd;
      extremes.tr = pt;
    }
  }
  const norm = (p: Point): Point => ({
    x: clamp(p.x / w, 0, 1),
    y: clamp(p.y / h, 0, 1),
  });
  return [norm(extremes.tl), norm(extremes.tr), norm(extremes.br), norm(extremes.bl)];
}

function paperRatio(paper: PaperShape, boxW: number, boxH: number): number {
  switch (paper.kind) {
    case "a4":
      return 841.89 / 595.28;
    case "letter":
      return 792 / 612;
    case "custom":
      return paper.heightMm / Math.max(1, paper.widthMm);
    default:
      return Math.max(boxH, 1) / Math.max(boxW, 1);
  }
}

function paperDims(paper: PaperShape, boxW: number, boxH: number): { w: number; h: number } {
  let w: number;
  let h: number;
  if (paper.kind === "custom") {
    w = paper.widthMm * MM_TO_PT;
    h = paper.heightMm * MM_TO_PT;
  } else if (paper.kind === "a4") {
    w = 595.28;
    h = 841.89;
  } else if (paper.kind === "letter") {
    w = 612;
    h = 792;
  } else {
    const ratio = paperRatio(paper, boxW, boxH);
    if (boxH >= boxW) {
      // Portrait: fix the long side (height) to A4, derive the short side.
      h = 841.89;
      w = Math.round(h / ratio);
    } else {
      // Landscape: fix the long side (width) to A4, derive the short side.
      w = 841.89;
      h = Math.round(w * ratio);
    }
  }
  // keep orientation matching the document
  const landscape = boxW > boxH;
  if (paper.kind !== "custom" && paper.kind !== "auto" && landscape) {
    [w, h] = [h, w];
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

// Solve the 8-dof planar homography H that maps 4 source points to 4 target
// points (h33 fixed to 1). Returns the raw 3x3 matrix [h0..h8], or null if the
// system is degenerate (e.g. collinear corners).
function homographyMatrix(src: Point[], dst: Point[]): number[] | null {
  const A: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: ux, y: uy } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -ux * x, -ux * y]);
    rhs.push(ux);
    A.push([0, 0, 0, x, y, 1, -uy * x, -uy * y]);
    rhs.push(uy);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    }
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    [rhs[c], rhs[piv]] = [rhs[piv], rhs[c]];
    const pv = A[c][c];
    for (let r = c; r < n; r++) A[c][r] /= pv;
    rhs[c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      rhs[r] -= f * rhs[c];
    }
  }
  return [...rhs, 1];
}

// Pick the 4 extreme corners (tl/tr/br/bl) of a point set by their diagonal
// coordinates, mirroring the classification used for document boundary.
function quadCorners(points: Point[]): Point[] | null {
  if (points.length < 4) return null;
  let iTL = 0,
    iTR = 0,
    iBR = 0,
    iBL = 0;
  let minS = Infinity,
    maxS = -Infinity,
    minD = Infinity,
    maxD = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const s = points[i].x + points[i].y;
    const d = points[i].x - points[i].y;
    if (s < minS) {
      minS = s;
      iTL = i;
    }
    if (s > maxS) {
      maxS = s;
      iBR = i;
    }
    if (d < minD) {
      minD = d;
      iBL = i;
    }
    if (d > maxD) {
      maxD = d;
      iTR = i;
    }
  }
  return [points[iTL], points[iTR], points[iBR], points[iBL]];
}

// Render the source into the target rectangle using a true perspective
// (homography) transform by sampling per pixel: for every output pixel we invert
// the homography to find its exact source coordinate, then bilinear-interpolate.
// This fills the rectangle edge-to-edge (including the top), preserves
// orientation, and — because each pixel is sampled independently — never leaves
// seams or holes the way an affine mesh can.
// Symmetric horizontal "curve" correction for a page curled around a vertical
// axis (rotation applied inline to a bulb page). strength in [-1,1]: 0 = off,
// positive pulls the outer columns source inward (flattens a page that bulges
// toward the camera), negative the opposite. Applied to the source x sample.
function applyCurve(sx: number, sw: number, strength: number): number {
  if (!strength) return sx;
  const half = sw / 2;
  const n = (sx - half) / (half || 1); // -1..1
  const k = strength * 0.6 * n * n; // 0 at center, ±0.6*strength at edges
  return half + (sx - half) * (1 - k);
}

function drawPerspective(
  ctx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  inv: (x: number, y: number) => Point,
  outW: number,
  outH: number,
  logicalW: number,
  logicalH: number,
  dewarpStrength = 0,
) {
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  const s = srcCanvas.getContext("2d")!.getImageData(0, 0, sw, sh).data;

  const out = ctx.createImageData(outW, outH);
  const o = out.data;

  // Sample the logical rectangle [0..logicalW]x[0..logicalH] at the output's
  // pixel density. When outW > logicalW the source is sampled more densely, so
  // the rendered canvas carries real detail (true higher DPI) rather than an
  // upscaled blur.
  const xStep = logicalW / outW;
  const yStep = logicalH / outH;

  for (let y = 0; y < outH; y++) {
    const fy = (y + 0.5) * yStep;
    for (let x = 0; x < outW; x++) {
      const p = inv((x + 0.5) * xStep, fy);
      // Bilinear sample in source space, optionally curved (page-curl dewarp).
      const sx = clamp(applyCurve(p.x, sw, dewarpStrength), 0, sw - 1);
      const sy = clamp(p.y, 0, sh - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0;
      const fy2 = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - fx) * (1 - fy2);
      const w10 = fx * (1 - fy2);
      const w01 = (1 - fx) * fy2;
      const w11 = fx * fy2;
      const oi = (y * outW + x) * 4;
      o[oi] = s[i00] * w00 + s[i10] * w10 + s[i01] * w01 + s[i11] * w11;
      o[oi + 1] = s[i00 + 1] * w00 + s[i10 + 1] * w10 + s[i01 + 1] * w01 + s[i11 + 1] * w11;
      o[oi + 2] = s[i00 + 2] * w00 + s[i10 + 2] * w10 + s[i01 + 2] * w01 + s[i11 + 2] * w11;
      o[oi + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
}

function mapBoundaryToRectangle(boundary: Point[], tw: number, th: number): Point[] {
  const n = boundary.length;
  if (n < 4) return boundary;

  const argExtreme = (fn: (p: Point) => number, pickMax: boolean) => {
    let best = 0;
    let bestVal = fn(boundary[0]);
    for (let i = 1; i < n; i++) {
      const v = fn(boundary[i]);
      if (pickMax ? v > bestVal : v < bestVal) {
        bestVal = v;
        best = i;
      }
    }
    return best;
  };

  // Classify the 4 corner points by their diagonal extremes in screen space.
  const cornerToRect: Record<string, Point> = {
    tl: { x: 0, y: 0 },
    tr: { x: tw, y: 0 },
    br: { x: tw, y: th },
    bl: { x: 0, y: th },
  };

  const pairs: { boundaryIdx: number; rect: Point }[] = [
    { boundaryIdx: argExtreme((p) => p.x + p.y, false), rect: cornerToRect.tl },
    { boundaryIdx: argExtreme((p) => p.x - p.y, true), rect: cornerToRect.tr },
    { boundaryIdx: argExtreme((p) => p.x + p.y, true), rect: cornerToRect.br },
    { boundaryIdx: argExtreme((p) => p.x - p.y, false), rect: cornerToRect.bl },
  ];
  // Loop order = ascending boundary index; keep each corner's rect attached.
  pairs.sort((a, b) => a.boundaryIdx - b.boundaryIdx);

  const out: Point[] = new Array(n);
  for (let r = 0; r < 4; r++) {
    const a = pairs[r].boundaryIdx;
    const b = pairs[(r + 1) % 4].boundaryIdx;
    const ca = pairs[r].rect;
    const cb = pairs[(r + 1) % 4].rect;

    const idxs: number[] = [];
    let i = a;
    let guard = 0;
    while (i !== b && guard <= n) {
      idxs.push(i);
      i = (i + 1) % n;
      guard++;
    }
    idxs.push(b);

    if (idxs.length === 1) {
      out[idxs[0]] = { x: ca.x, y: ca.y };
      continue;
    }

    const cum: number[] = [0];
    for (let k = 1; k < idxs.length; k++) {
      const p0 = boundary[idxs[k - 1]];
      const p1 = boundary[idxs[k]];
      cum.push(cum[k - 1] + dist(p0.x, p0.y, p1.x, p1.y));
    }
    const total = cum[cum.length - 1] || 1;
    for (let k = 0; k < idxs.length; k++) {
      const t = k === 0 ? 0 : k === idxs.length - 1 ? 1 : cum[k] / total;
      out[idxs[k]] = { x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t };
    }
  }
  return out;
}

// Render the loaded image rotated clockwise by `rotation` and return the source
// canvas together with a mapping that converts a point from the original
// (normalized) frame to the rotated (normalized) frame. Used so the perspective
// warp always operates on an upright document.
function renderRotatedSource(
  image: HTMLImageElement,
  rotation: Rotate,
): {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  mapNorm: (p: Point) => Point;
} {
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  let width = iw;
  let height = ih;
  let mapNorm: (p: Point) => Point;

  if (rotation === 90) {
    width = ih;
    height = iw;
    c.width = width;
    c.height = height;
    ctx.translate(ih, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, 0, 0);
    mapNorm = (p) => ({ x: 1 - p.y, y: p.x });
  } else if (rotation === 180) {
    width = iw;
    height = ih;
    c.width = width;
    c.height = height;
    ctx.translate(iw, ih);
    ctx.rotate(Math.PI);
    ctx.drawImage(image, 0, 0);
    mapNorm = (p) => ({ x: 1 - p.x, y: 1 - p.y });
  } else if (rotation === 270) {
    width = ih;
    height = iw;
    c.width = width;
    c.height = height;
    ctx.translate(0, iw);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(image, 0, 0);
    mapNorm = (p) => ({ x: p.y, y: 1 - p.x });
  } else {
    width = iw;
    height = ih;
    c.width = width;
    c.height = height;
    ctx.drawImage(image, 0, 0);
    mapNorm = (p) => p;
  }
  return { canvas: c, width, height, mapNorm };
}

// Run the heavy warp + filter in the image Web Worker. Returns null (falling
// back to the main thread) if the worker is unavailable or the task fails.
async function tryWorkerWarp(
  sourceCanvas: HTMLCanvasElement,
  h: number[],
  pxW: number,
  pxH: number,
  tw: number,
  th: number,
  filter: FilterMode,
  adjust?: Adjust,
  shadow?: boolean,
  sharpen?: boolean,
): Promise<HTMLCanvasElement | null> {
  try {
    const W = sourceCanvas.width;
    const H = sourceCanvas.height;
    const imgData = sourceCanvas.getContext("2d")!.getImageData(0, 0, W, H);
    const out = await warpInWorker({
      type: "warp",
      src: imgData.data.buffer as ArrayBuffer,
      srcW: W,
      srcH: H,
      h,
      outW: pxW,
      outH: pxH,
      logicalW: tw,
      logicalH: th,
      filter,
      adjust,
      shadow: !!shadow,
      sharpen: !!sharpen,
    });
    const c = document.createElement("canvas");
    c.width = pxW;
    c.height = pxH;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.putImageData(new ImageData(out, pxW, pxH), 0, 0);
    return c;
  } catch {
    return null;
  }
}

export async function warpPoly({
  src,
  boundary,
  paper,
  filter,
  adjust,
  maxDim,
  shadow,
  sharpen,
  renderScale,
  rotation = 0,
  dewarpStrength = 0,
}: {
  src: string;
  boundary?: Point[];
  paper: PaperShape;
  filter: FilterMode;
  adjust?: Adjust;
  maxDim?: number;
  shadow?: boolean;
  sharpen?: boolean;
  /** Render the output canvas at a higher pixel density than the logical page
   *  size (e.g. 200 DPI vs the default 72 DPI) without changing the returned
   *  width/height, which stay as the PDF page size in points. */
  renderScale?: number;
  /** Rotate the whole document (source + boundary) clockwise by 0/90/180/270 so
   *  the warped page is upright. Applied before the perspective warp. */
  rotation?: Rotate;
  /** Page-curl dewarp strength in [-1, 1]; when set it bypasses the Web Worker
   *  so the curve correction stays on the main-thread sampling path. */
  dewarpStrength?: number;
}): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const image = await loadImage(src);
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;

  // Build the source canvas (optionally rotated) and the boundary in its frame.
  let sourceCanvas: HTMLCanvasElement;
  let W: number;
  let H: number;
  let pts = boundary && boundary.length >= 3 ? boundary : FULL_BOUNDARY;

  if (rotation % 360 !== 0) {
    const r = renderRotatedSource(image, rotation as Rotate);
    sourceCanvas = r.canvas;
    W = r.width;
    H = r.height;
    // Map the boundary from the original frame into the rotated frame.
    pts = pts.map((p) => r.mapNorm(p));
  } else {
    W = iw;
    H = ih;
    sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = W;
    sourceCanvas.height = H;
    sourceCanvas.getContext("2d")!.drawImage(image, 0, 0);
  }

  pts = pts.map((p) => ({
    x: clamp(p.x, 0, 1) * W,
    y: clamp(p.y, 0, 1) * H,
  }));

  const hull = convexHull(pts);
  let boxW = W;
  let boxH = H;
  if (hull.length >= 3) {
    const box = minAreaRect(hull);
    if (box.length === 4) {
      const xs = box.map((p) => p.x);
      const ys = box.map((p) => p.y);
      boxW = Math.max(...xs) - Math.min(...xs);
      boxH = Math.max(...ys) - Math.min(...ys);
    }
  }

  let target = paperDims(paper, boxW, boxH);
  if (maxDim) {
    const scale = Math.min(1, maxDim / Math.max(target.w, target.h));
    target = { w: Math.round(target.w * scale), h: Math.round(target.h * scale) };
  }
  const tw = Math.max(1, Math.round(target.w));
  const th = Math.max(1, Math.round(target.h));
  // Output pixel size — a higher renderScale produces more detail from the
  // original source. The returned width/height stay tw/th (the PDF page size).
  const pxW = Math.max(1, Math.round(tw * (renderScale ?? 1)));
  const pxH = Math.max(1, Math.round(th * (renderScale ?? 1)));

  const make = (w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cctx = c.getContext("2d")!;
    cctx.imageSmoothingQuality = "high";
    cctx.fillStyle = "#ffffff";
    cctx.fillRect(0, 0, w, h);
    return { c, cctx };
  };

  // Warp via a true homography rendered as a seam-free mesh. This fills the
  // rectangle edge-to-edge (including the top), preserves orientation and draws
  // from the full-resolution source, so it stays crisp. Each cell corner maps
  // through the exact homography, which makes the mesh seamless.
  const corners = quadCorners(pts);
  let canvas: HTMLCanvasElement | null = null;
  let filterApplied = false;
  if (corners) {
    const h = homographyMatrix(
      [
        { x: 0, y: 0 },
        { x: tw, y: 0 },
        { x: tw, y: th },
        { x: 0, y: th },
      ],
      corners,
    );
    if (h) {
      // When dewarp is active the curve lives only in the main-thread sampler,
      // so bypass the worker and render here (also applies the filter below).
      if (dewarpStrength !== 0) {
        const inv = (x: number, y: number) => {
          const d = h[6] * x + h[7] * y + h[8];
          return {
            x: (h[0] * x + h[1] * y + h[2]) / d,
            y: (h[3] * x + h[4] * y + h[5]) / d,
          };
        };
        const { c } = make(pxW, pxH);
        drawPerspective(c.getContext("2d")!, sourceCanvas, inv, pxW, pxH, tw, th, dewarpStrength);
        canvas = c;
      } else {
        // Try the off-main-thread warp first; fall back to the main-thread path
        // below (which also applies the filter) if the worker can't run.
        const workerCanvas = await tryWorkerWarp(
          sourceCanvas,
          h,
          pxW,
          pxH,
          tw,
          th,
          filter,
          adjust,
          shadow,
          sharpen,
        );
        if (workerCanvas) {
          canvas = workerCanvas;
          filterApplied = true;
        } else {
          const inv = (x: number, y: number) => {
            const d = h[6] * x + h[7] * y + h[8];
            return {
              x: (h[0] * x + h[1] * y + h[2]) / d,
              y: (h[3] * x + h[4] * y + h[5]) / d,
            };
          };
          const { c } = make(pxW, pxH);
          drawPerspective(c.getContext("2d")!, sourceCanvas, inv, pxW, pxH, tw, th);
          canvas = c;
        }
      }
    }
  }

  // Fallback: arbitrary (non-quad) boundary via centroid-split triangles.
  if (!canvas) {
    const { c, cctx } = make(pxW, pxH);
    // Scale the logical (point) coordinates up to the output pixel size so the
    // fallback mesh also benefits from a higher-DPI render.
    const pxScale = pxW / tw;
    cctx.scale(pxScale, pxScale);
    const targetPts = mapBoundaryToRectangle(pts, tw, th);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const srcCentroid = { x: cx, y: cy };
    const tCentroid = { x: tw / 2, y: th / 2 };
    let drawn = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const m = affineTransform(
        pts[i],
        pts[j],
        srcCentroid,
        targetPts[i],
        targetPts[j],
        tCentroid,
      );
      if (!m) continue;
      cctx.save();
      cctx.beginPath();
      cctx.moveTo(targetPts[i].x, targetPts[i].y);
      cctx.lineTo(targetPts[j].x, targetPts[j].y);
      cctx.lineTo(tCentroid.x, tCentroid.y);
      cctx.closePath();
      cctx.clip();
      cctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      cctx.drawImage(sourceCanvas, 0, 0);
      cctx.restore();
      drawn++;
    }
    if (drawn === 0) {
      const minX = Math.min(...pts.map((p) => p.x));
      const maxX = Math.max(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxY = Math.max(...pts.map((p) => p.y));
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      cctx.drawImage(sourceCanvas, minX, minY, bw, bh, 0, 0, tw, th);
    }
    canvas = c;
  }

  if (!filterApplied) applyFilter(canvas, filter, adjust, { shadow, sharpen });
  return { canvas, width: tw, height: th };
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
  type = "image/jpeg",
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Xuất ảnh thất bại."))),
      type,
      quality,
    );
  });
}

export async function fileToSrc(file: File, maxDim = 2200): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const W = image.naturalWidth;
    const H = image.naturalHeight;
    const scale = Math.min(1, maxDim / Math.max(W, H));
    const outW = Math.round(W * scale);
    const outH = Math.round(H * scale);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, outW, outH);
    const blob = await canvasToBlob(canvas, 0.9);
    return URL.createObjectURL(blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}
