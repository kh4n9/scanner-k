// Pure, DOM-free pixel operations shared by the main thread and the image
// Web Worker. Nothing here touches `document`, `canvas`, or the DOM, so it can
// be imported by a worker bundle. The main-thread path in `image.ts` keeps its
// own copies; the two must stay in sync so a worker render matches a main-
// thread render exactly.

import type { Adjust, FilterMode } from "./types";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeAdjust(adjust?: Adjust): Adjust {
  return {
    brightness: adjust?.brightness ?? 1,
    contrast: adjust?.contrast ?? 1,
    saturation: adjust?.saturation ?? 1,
  };
}

function getLuminance(d: Uint8ClampedArray, n: number): Float32Array {
  const lum = new Float32Array(n);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    lum[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  }
  return lum;
}

function boxBlur(src: Float32Array, w: number, h: number, radius: number) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = radius * 2 + 1;
  const at = (x: number, y: number) => {
    const cx = clamp(x, 0, w - 1);
    const cy = clamp(y, 0, h - 1);
    return src[cy * w + cx];
  };
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += at(x, y);
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / win;
      acc += at(x + radius + 1, y) - at(x - radius, y);
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const addY = clamp(y + radius + 1, 0, h - 1);
      const subY = clamp(y - radius, 0, h - 1);
      acc += tmp[addY * w + x] - tmp[subY * w + x];
    }
  }
  return out;
}

// Separable maximum filter (morphological dilation). The background of a page is
// the brightness of the paper, so we take the local MAX — dark text/corners must
// not pull the estimate down, otherwise normalizing would brighten them too.
function maxFilter(src: Float32Array, w: number, h: number, radius: number) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const dq = new Int32Array(w);
    let head = 0;
    let tail = 0;
    for (let x = 0; x < w; x++) {
      while (tail > head && src[row + dq[tail - 1]] <= src[row + x]) tail--;
      dq[tail++] = x;
      if (dq[head] <= x - win) head++;
      tmp[row + x] = src[row + dq[head]];
    }
  }
  for (let x = 0; x < w; x++) {
    const dq = new Int32Array(h);
    let head = 0;
    let tail = 0;
    for (let y = 0; y < h; y++) {
      while (tail > head && tmp[dq[tail - 1] * w + x] <= tmp[y * w + x]) tail--;
      dq[tail++] = y;
      if (dq[head] <= y - win) head++;
      out[y * w + x] = tmp[dq[head] * w + x];
    }
  }
  return out;
}

// Flatten uneven illumination: estimate the white paper level per-pixel (local
// max, so text never drags it down), then scale each pixel toward white. Shadows
// fade but dark ink keeps its relative darkness — text is preserved.
function normalizeBackground(d: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  const lum = getLuminance(d, n);
  const radius = Math.max(8, Math.round(Math.min(w, h) * 0.05));
  const paper = maxFilter(lum, w, h, radius);
  const bg = boxBlur(paper, w, h, Math.max(2, Math.round(radius * 0.5)));
  for (let p = 0; p < n; p++) {
    const scale = clamp(255 / Math.max(40, bg[p]), 0.95, 2.1);
    const i = p * 4;
    d[i] = clamp(d[i] * scale, 0, 255);
    d[i + 1] = clamp(d[i + 1] * scale, 0, 255);
    d[i + 2] = clamp(d[i + 2] * scale, 0, 255);
  }
}

// Light unsharp mask: out = orig + amount*(orig - blur).
function unsharpMask(d: Uint8ClampedArray, w: number, h: number, amount = 0.7) {
  const n = w * h;
  const channel = new Float32Array(n);
  for (let ch = 0; ch < 3; ch++) {
    for (let p = 0; p < n; p++) channel[p] = d[p * 4 + ch];
    const blur = boxBlur(channel, w, h, 1);
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      const v = d[i + ch] + amount * (d[i + ch] - blur[p]);
      d[i + ch] = clamp(v, 0, 255);
    }
  }
}

// Sauvola adaptive binarization using integral images. Text stays crisp even in
// shadowed / uneven regions, unlike a single global threshold.
function adaptiveThreshold(d: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  const lum = getLuminance(d, n);
  const W1 = w + 1;
  const sum = new Float64Array((w + 1) * (h + 1));
  const sumsq = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x];
      const v2 = v * v;
      const i = (y + 1) * W1 + (x + 1);
      sum[i] = v + sum[y * W1 + (x + 1)] + sum[(y + 1) * W1 + x] - sum[y * W1 + x];
      sumsq[i] = v2 + sumsq[y * W1 + (x + 1)] + sumsq[(y + 1) * W1 + x] - sumsq[y * W1 + x];
    }
  }
  const radius = Math.max(7, Math.round(Math.min(w, h) * 0.06));
  const k = 0.22;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = clamp(x - radius, 0, w - 1);
      const xr = clamp(x + radius, 0, w - 1);
      const yt = clamp(y - radius, 0, h - 1);
      const yb = clamp(y + radius, 0, h - 1);
      const area = (xr - xl + 1) * (yb - yt + 1);
      const s = sum[(yb + 1) * W1 + (xr + 1)] - sum[yt * W1 + (xr + 1)] - sum[(yb + 1) * W1 + xl] + sum[yt * W1 + xl];
      const sq = sumsq[(yb + 1) * W1 + (xr + 1)] - sumsq[yt * W1 + (xr + 1)] - sumsq[(yb + 1) * W1 + xl] + sumsq[yt * W1 + xl];
      const mean = s / area;
      const std = Math.sqrt(Math.max(0, sq / area - mean * mean));
      const t = mean * (1 + k * (std / 128 - 1));
      const i = (y * w + x) * 4;
      const on = lum[y * w + x] >= t ? 255 : 0;
      d[i] = on;
      d[i + 1] = on;
      d[i + 2] = on;
    }
  }
}

// Apply the full filter pipeline (shadow flatten, sharpen, then binarization or
// the color/grayscale correction loop) directly on a raw RGBA buffer.
export function applyFilterRgba(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  filter: FilterMode,
  adjust?: Adjust,
  opts?: { shadow?: boolean; sharpen?: boolean },
): boolean {
  const a = normalizeAdjust(adjust);
  const wantShadow = !!opts?.shadow;
  const wantSharpen = !!opts?.sharpen;
  const neutral =
    !wantShadow &&
    !wantSharpen &&
    filter === "original" &&
    a.brightness === 1 &&
    a.contrast === 1 &&
    a.saturation === 1;
  if (neutral) return false;

  const isGray = filter === "grayscale";
  const isBw = filter === "bw";

  if (wantShadow) normalizeBackground(d, w, h);
  if (wantSharpen) unsharpMask(d, w, h);

  if (isBw) {
    adaptiveThreshold(d, w, h);
    return true;
  }

  const sat = isGray ? 0 : a.saturation;
  const contrast = a.contrast;
  const brightness = a.brightness;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let cr = l + (r - l) * sat;
    let cg = l + (g - l) * sat;
    let cb = l + (b - l) * sat;
    cr = (cr - 128) * contrast + 128;
    cg = (cg - 128) * contrast + 128;
    cb = (cb - 128) * contrast + 128;
    d[i] = clamp(cr * brightness, 0, 255);
    d[i + 1] = clamp(cg * brightness, 0, 255);
    d[i + 2] = clamp(cb * brightness, 0, 255);
  }
  return true;
}

// Bilinear perspective sample: for every output pixel in the logical rectangle
// [0..logicalW]x[0..logicalH], invert the homography `h` to find its source
// coordinate and bilinearly interpolate the source RGBA. Mirrors `drawPerspective`
// on the main thread, but writes to a raw buffer instead of a canvas.
export function warpRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  h: number[],
  outW: number,
  outH: number,
  logicalW: number,
  logicalH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const xStep = logicalW / outW;
  const yStep = logicalH / outH;

  for (let y = 0; y < outH; y++) {
    const fy = (y + 0.5) * yStep;
    for (let x = 0; x < outW; x++) {
      const lx = (x + 0.5) * xStep;
      const d = h[6] * lx + h[7] * fy + h[8];
      const sx = clamp((h[0] * lx + h[1] * fy + h[2]) / d, 0, sw - 1);
      const sy = clamp((h[3] * lx + h[4] * fy + h[5]) / d, 0, sh - 1);
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
      out[oi] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      out[oi + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
      out[oi + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
      out[oi + 3] = 255;
    }
  }
  return out;
}
