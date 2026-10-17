// Pure, DOM-free pixel operations shared by the main thread and the image
// Web Worker. Nothing here touches `document`, `canvas`, or the DOM, so it can
// be imported by a worker bundle. This is the single implementation of the
// filter pipeline: the main-thread path in `image.ts` calls `applyFilterRgba`
// too, so a worker render and a main-thread render can never drift apart.

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

// Separable sliding-window extremum. `pickMax` selects a maximum filter
// (morphological dilation) or a minimum filter (erosion). The background of a
// page is the brightness of the paper, so the dilation is what stops dark text
// and rules from pulling the estimate down and making normalization brighten
// them too.
//
// The window is CENTRED on each output pixel. A naive monotonic-deque sweep
// gives an off-centre window that only looks back, which biases the estimate
// toward whichever side of the page happens to be brighter — the paper would
// then come out a different shade depending on which way the light fell,
// precisely the lighting-dependence this pass exists to remove.
function extremumFilter(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
  pickMax: boolean,
) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // Horizontal pass over the centred window [x - radius, x + radius].
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const dq = new Int32Array(w);
    let head = 0;
    let tail = 0;
    // Prime with the columns left of centre so the first output already sees
    // its full window. The deque never holds an out-of-range index, so at the
    // edges the window simply shrinks — the same result clamping would give.
    for (let k = 0; k < radius && k < w; k++) {
      const nxt = src[row + k];
      while (tail > head) {
        const cur = src[row + dq[tail - 1]];
        if (pickMax ? cur > nxt : cur < nxt) break;
        tail--;
      }
      dq[tail++] = k;
    }
    for (let x = 0; x < w; x++) {
      const add = x + radius;
      if (add < w) {
        const nxt = src[row + add];
        while (tail > head) {
          const cur = src[row + dq[tail - 1]];
          if (pickMax ? cur > nxt : cur < nxt) break;
          tail--;
        }
        dq[tail++] = add;
      }
      if (dq[head] < x - radius) head++;
      tmp[row + x] = src[row + dq[head]];
    }
  }
  // Vertical pass over the centred window [y - radius, y + radius].
  for (let x = 0; x < w; x++) {
    const dq = new Int32Array(h);
    let head = 0;
    let tail = 0;
    for (let k = 0; k < radius && k < h; k++) {
      const nxt = tmp[k * w + x];
      while (tail > head) {
        const cur = tmp[dq[tail - 1] * w + x];
        if (pickMax ? cur > nxt : cur < nxt) break;
        tail--;
      }
      dq[tail++] = k;
    }
    for (let y = 0; y < h; y++) {
      const add = y + radius;
      if (add < h) {
        const nxt = tmp[add * w + x];
        while (tail > head) {
          const cur = tmp[dq[tail - 1] * w + x];
          if (pickMax ? cur > nxt : cur < nxt) break;
          tail--;
        }
        dq[tail++] = add;
      }
      if (dq[head] < y - radius) head++;
      out[y * w + x] = tmp[dq[head] * w + x];
    }
  }
  return out;
}

// Never lift a pixel by more than this. Real paper across a single page varies
// by well under 2.5x (a heavily vignetted corner sits around 90-110 encoded),
// so the cap still reaches pure white on real paper while bounding how much
// sensor grain and JPEG blocking get amplified in the darks.
const MAX_BG_GAIN = 2.5;

// The paper level of the page as a whole, taken as a high percentile per channel.
const PAPER_PERCENTILE = 0.97;

// How much to average each channel before estimating the paper level. The
// estimate is a local MAX, so without this it chases sensor noise instead of the
// paper (see `normalizeBackground`).
const DENOISE_RADIUS = 3;

// Where to put the white point, relative to where the paper actually lands after
// the flat field. Driving the paper onto pure white is what makes a scan print
// white instead of a grey wash: dividing by a local MAX leaves the sheet a level
// or two short (the estimate sits above the paper's mean), and that residue is
// exactly what a printer renders as grey. The margin lets the paper's own
// unevenness clip away too, so the sheet comes out flat rather than mottled.
const PAPER_WHITE_PERCENTILE = 0.7;
const PAPER_KNEE_MARGIN = 4;
// Below this the page has no paper to speak of (a photo, not a document) and the
// white point must be left alone.
const MIN_PAPER_LEVEL = 200;
const MAX_WHITE_GAIN = 1.2;

function gainFor(bg: number) {
  return clamp(255 / Math.max(1, bg), 1, MAX_BG_GAIN);
}

/**
 * Auto-enhance parameters from a scan's luminance statistics. Pure, so the
 * harness can exercise the combination that actually ships.
 *
 * Both knobs are one-way: contrast may only rise, and brightness may only rise.
 * The brightness floor used to be 0.8, which meant a page filling a well-lit
 * frame (mean ~167) got brightness 0.8 — and because brightness is applied AFTER
 * the background is flattened, it multiplied the white sheet straight back down
 * to ~209 and the page printed grey however good the flattening was.
 */
export function autoAdjust(mean: number, p05: number, p95: number): Adjust {
  const spread = Math.max(1, p95 - p05);
  return {
    brightness: clamp(128 / Math.max(1, mean), 1.0, 1.5),
    contrast: clamp(128 / spread, 1.0, 1.8),
    saturation: 1.12,
  };
}

// Flatten uneven lighting and make the paper white whatever the light looked
// like. Paper is the locally brightest surface, so for each channel we estimate
// the paper level with a morphological closing (a local MAX to keep text and
// rules from dragging the estimate down, then a matching MIN to take back the
// bias that dilation adds on a lighting slope) and divide the pixel by it. Going per channel rather than on luminance
// alone is what removes a colour cast: a page shot under warm light has warm
// paper, and its blue channel is simply divided by a smaller number, so the
// paper lands on white. Because the estimate is local, shadows and vignetting
// flatten at the same time.
//
// This is a von Kries diagonal correction using the paper as the local white
// point, so an ink that is a neutral density over the paper comes out exactly
// neutral (paper (250,232,196) gains (1.02, 1.10, 1.30); neutral ink at 14% of
// paper goes (35.0, 32.5, 27.4) -> (35.7, 35.7, 35.7)). Doing it on
// sRGB-encoded values instead of linear light costs at most ~2 LSB because a
// power-law encoding commutes with multiplication — not worth a pow() per pixel.
function normalizeBackground(d: Uint8ClampedArray, w: number, h: number) {
  // The paper/illumination field is smooth, so estimate it on a grid `step`
  // times coarser: max-pool each channel (a block's brightest sample is that
  // block's paper — mean-pooling would let text drag it down), run the max and
  // blur filters there, then bilinearly upsample while applying. On a 200-DPI
  // A4 page that is ~25x less work than filtering every pixel; on small images
  // (thumbnails, min side <= 320) step is 1 and it stays exact.
  const step = clamp(Math.round(Math.min(w, h) / 320), 1, 6);
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const gn = gw * gh;
  const bg: Float32Array[] = [
    new Float32Array(gn),
    new Float32Array(gn),
    new Float32Array(gn),
  ];
  // Per-channel histogram, built while pooling, so the page-wide paper level
  // costs no extra traversal or sort.
  const hist: Uint32Array[] = [
    new Uint32Array(256),
    new Uint32Array(256),
    new Uint32Array(256),
  ];

  // Denoise BEFORE estimating. The estimate is a local MAX, and a max latches
  // onto the brightest noise speck inside its window: with the 2-4 levels of
  // sensor noise a real photo carries, and a window that sees thousands of
  // samples, the max sits several sigma above the paper's true level. That
  // pushes the paper down (a grey rather than white background) and — because
  // the overshoot differs from place to place — leaves it blotchy. Averaging a
  // neighbourhood first divides the noise before any max is taken, so the
  // estimate settles on the paper's level instead of its peaks. Text survives
  // this: a blur only softens a stroke, and the max that follows still finds
  // paper inside its window.
  //
  // The averaging happens on a half-size copy. A 2x2 mean there plus a small box
  // blur still averages tens of source pixels per sample — enough to kill the
  // bias — for a quarter of the work, and the pooling below then reads a quarter
  // as many samples. With `step` at 1 (small images) there is no room to shrink
  // without leaving grid cells unsampled, so it stays at full size and leans on
  // the blur alone.
  const ds = step >= 2 ? 2 : 1;
  const sw = Math.ceil(w / ds);
  const sh = Math.ceil(h / ds);
  const sample = new Float32Array(sw * sh);
  // One sample per pooled cell, not per pixel.
  const samples = sw * sh;
  const radius = Math.max(8, Math.min(w, h) * 0.05);
  const rMax = Math.max(1, Math.round(radius / step));
  const rBlur = Math.max(1, Math.round(rMax / 2));
  const whiteScale: number[] = [1, 1, 1];
  for (let ch = 0; ch < 3; ch++) {
    for (let y = 0; y < h; y += ds) {
      const y2 = Math.min(y + ds - 1, h - 1);
      const hrow = ((y / ds) | 0) * sw;
      for (let x = 0; x < w; x += ds) {
        const x2 = Math.min(x + ds - 1, w - 1);
        sample[hrow + ((x / ds) | 0)] =
          (d[(y * w + x) * 4 + ch] +
            d[(y * w + x2) * 4 + ch] +
            d[(y2 * w + x) * 4 + ch] +
            d[(y2 * w + x2) * 4 + ch]) /
          4;
      }
    }
    const smooth = boxBlur(sample, sw, sh, DENOISE_RADIUS);
    const bch = bg[ch];
    const hch = hist[ch];
    for (let sy = 0; sy < sh; sy++) {
      const grow = (((sy * ds) / step) | 0) * gw;
      const hrow = sy * sw;
      for (let sx = 0; sx < sw; sx++) {
        const v = smooth[hrow + sx];
        const g = grow + (((sx * ds) / step) | 0);
        if (v > bch[g]) bch[g] = v;
        hch[v | 0]++;
      }
    }

    let acc = 0;
    let cap = 255;
    const want = PAPER_PERCENTILE * samples;
    for (let v = 0; v < 256; v++) {
      acc += hch[v];
      if (acc >= want) {
        cap = v;
        break;
      }
    }
    // Cap the local estimate at the page's paper level. A specular highlight is
    // brighter than paper: uncapped it would pin the estimate at 255, drive the
    // gain to 1 and leave the shadowed paper around it un-flattened.
    //
    // This is a morphological closing (dilate then erode) rather than a plain
    // dilation. Dilation alone is biased upward wherever the illumination
    // slopes, which would leave the paper a few percent grey on the shadowed
    // side — a lighting-dependent result again. The erosion takes that bias back
    // out (it cancels exactly for a smooth gradient) while keeping ink removed,
    // and since the dilation had already pulled dark regions in by rMax, the
    // erosion only restores them to their true edges — no halo grows around a
    // large dark graphic.
    const closed = extremumFilter(
      extremumFilter(bg[ch], gw, gh, rMax, true),
      gw,
      gh,
      rMax,
      false,
    );
    const filtered = boxBlur(closed, gw, gh, rBlur);
    for (let i = 0; i < gn; i++) {
      bch[i] = Math.min(filtered[i], cap);
    }

    // Where THIS channel's paper actually lands after the flat field. Driving the
    // sheet onto pure white is what makes a scan print white instead of a grey
    // wash: dividing by a local MAX leaves the paper a level or two short, and
    // that residue is exactly what a printer renders as grey. Measuring per
    // channel takes a faint cast left by the light out with it. The margin lets
    // the paper's own unevenness clip away too, so the sheet comes out flat
    // rather than mottled. Everything below the knee shifts by only a couple of
    // percent, so ink and grey fills survive.
    const whiteHist = new Uint32Array(256);
    for (let sy = 0; sy < sh; sy++) {
      const grow = (((sy * ds) / step) | 0) * gw;
      const hrow = sy * sw;
      for (let sx = 0; sx < sw; sx++) {
        const v = smooth[hrow + sx] * gainFor(bch[grow + (((sx * ds) / step) | 0)]);
        whiteHist[v < 0 ? 0 : v > 255 ? 255 : v | 0]++;
      }
    }
    let wacc = 0;
    let level = 0;
    const wwant = PAPER_WHITE_PERCENTILE * samples;
    for (let v = 0; v < 256; v++) {
      wacc += whiteHist[v];
      if (wacc >= wwant) {
        level = v;
        break;
      }
    }
    // Below this there is no paper to speak of (a photo, not a document).
    if (level >= MIN_PAPER_LEVEL) {
      whiteScale[ch] = clamp(255 / Math.max(1, level - PAPER_KNEE_MARGIN), 1, MAX_WHITE_GAIN);
    }
  }
  const [wsR, wsG, wsB] = whiteScale;

  const [bgR, bgG, bgB] = bg;
  const invStep = 1 / step;
  for (let y = 0; y < h; y++) {
    // Bilinear weights are the same for all three channels, so work them out once.
    const yf = (y + 0.5) * invStep - 0.5;
    const y0 = Math.floor(yf);
    const fy = yf - y0;
    const ya = clamp(y0, 0, gh - 1) * gw;
    const yb = clamp(y0 + 1, 0, gh - 1) * gw;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const xf = (x + 0.5) * invStep - 0.5;
      const x0 = Math.floor(xf);
      const fx = xf - x0;
      const xa = clamp(x0, 0, gw - 1);
      const xb = clamp(x0 + 1, 0, gw - 1);
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      // Upsample the background value and then derive the gain — gain is
      // nonlinear in bg, so interpolating bg is the stable choice.
      const bR = bgR[ya + xa] * w00 + bgR[ya + xb] * w10 + bgR[yb + xa] * w01 + bgR[yb + xb] * w11;
      const bG = bgG[ya + xa] * w00 + bgG[ya + xb] * w10 + bgG[yb + xa] * w01 + bgG[yb + xb] * w11;
      const bB = bgB[ya + xa] * w00 + bgB[ya + xb] * w10 + bgB[yb + xa] * w01 + bgB[yb + xb] * w11;
      const i = (row + x) * 4;
      d[i] = clamp(d[i] * gainFor(bR) * wsR, 0, 255);
      d[i + 1] = clamp(d[i + 1] * gainFor(bG) * wsG, 0, 255);
      d[i + 2] = clamp(d[i + 2] * gainFor(bB) * wsB, 0, 255);
    }
  }
}

// Light unsharp mask: out = orig + amount*(orig - blur).
//
// The dead zone is what lets the amount be high enough to crisp up the text of
// a scan upsampled to the export DPI without also amplifying paper grain: only
// differences larger than `threshold` levels are boosted, and the boost is
// reduced by that threshold so the transition stays smooth. Text edges clear it
// easily; sensor noise left in the flats (background flattening can amplify it
// up to MAX_BG_GAIN) mostly does not.
function unsharpMask(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  amount = 1.0,
  threshold = 2,
) {
  const n = w * h;
  const channel = new Float32Array(n);
  for (let ch = 0; ch < 3; ch++) {
    for (let p = 0; p < n; p++) channel[p] = d[p * 4 + ch];
    const blur = boxBlur(channel, w, h, 1);
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      const diff = d[i + ch] - blur[p];
      const boost =
        diff > threshold ? diff - threshold : diff < -threshold ? diff + threshold : 0;
      d[i + ch] = clamp(d[i + ch] + amount * boost, 0, 255);
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

// Whether the pipeline would leave every pixel untouched. Exported so the
// canvas path in `image.ts` can skip `getImageData`/`putImageData` entirely for
// the common "no processing" case instead of reading the buffer to find out.
export function isNeutralFilter(
  filter: FilterMode,
  adjust?: Adjust,
  opts?: { shadow?: boolean; sharpen?: boolean },
): boolean {
  if (opts?.shadow || opts?.sharpen) return false;
  if (filter !== "original") return false;
  const a = normalizeAdjust(adjust);
  return a.brightness === 1 && a.contrast === 1 && a.saturation === 1;
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
  if (isNeutralFilter(filter, adjust, opts)) return false;

  const a = normalizeAdjust(adjust);
  const wantShadow = !!opts?.shadow;
  const wantSharpen = !!opts?.sharpen;
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
