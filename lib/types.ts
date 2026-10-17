export type FilterMode = "original" | "color" | "grayscale" | "bw";

/** Clockwise page rotation in degrees. */
export type Rotate = 0 | 90 | 180 | 270;

export interface Point {
  x: number;
  y: number;
}

export interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
}

export const NEUTRAL_ADJUST: Adjust = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
};

export type PaperShape =
  | { kind: "auto" }
  | { kind: "a4" }
  | { kind: "letter" }
  | { kind: "custom"; widthMm: number; heightMm: number };

/** Signed normalized sagitta per edge, in the unrotated normalized frame:
 *  [top, right, bottom, left]. Positive = the paper silhouette bows inward
 *  (toward the page interior) relative to the chord between the edge's two
 *  corners; negative = it bulges outward; 0 = straight. */
export type EdgeCurves = [number, number, number, number];

export const NO_CURVES: EdgeCurves = [0, 0, 0, 0];

/** What the boundary detectors return: the 4 corner quad plus how far each of
 *  its edges bows away from the straight chord (see `EdgeCurves`). */
export interface DetectResult {
  boundary: Point[];
  curves: EdgeCurves;
}

/** Unsharp-mask amount used when a page has no explicit strength. 1 would be
 *  the neutral value of the formula; the default sits above it because a scan
 *  of text is almost always read at a smaller size than it was captured at. */
export const DEFAULT_SHARPEN = 1.2;

/** The sharpening amount to hand the warp pipeline: 0 when the page's sharpen
 *  toggle is off, otherwise the page's strength (or the default). */
export function activeSharpen(page: {
  sharpen?: boolean;
  sharpenStrength?: number;
}): number {
  if (!page.sharpen) return 0;
  return page.sharpenStrength ?? DEFAULT_SHARPEN;
}

/** The curvature a page should actually be warped with — `undefined` when the
 *  user has turned the automatic edge flattening off, so every consumer can
 *  pass the same value to `warpPoly` without repeating the check. */
export function activeCurves(page: {
  curves?: EdgeCurves;
  curvesEnabled?: boolean;
}): EdgeCurves | undefined {
  if (page.curvesEnabled === false) return undefined;
  return page.curves;
}

/** Multi-point document boundary, ordered around the document (normalized 0..1). */
export interface ScanPage {
  id: string;
  src: string;
  name: string;
  boundary: Point[];
  paper: PaperShape;
  filter: FilterMode;
  adjust: Adjust;
  /** Flatten shadows and even out the white paper background. */
  shadow?: boolean;
  /** Apply an unsharp mask for extra crispness. */
  sharpen?: boolean;
  /** Unsharp-mask amount when `sharpen` is on; see `DEFAULT_SHARPEN`. */
  sharpenStrength?: number;
  /** Rotate the whole page clockwise before the perspective warp. */
  rotation?: Rotate;
  /** Page-curl dewarp strength in [-1, 1]; 0/undefined = off. Positive flattens
   *  a page bulging toward the camera, negative the opposite. */
  dewarpStrength?: number;
  /** Measured bow of each paper edge (see `EdgeCurves`). The warp stretches a
   *  bowed edge out to the page border so no background shows along it. */
  curves?: EdgeCurves;
  /** Whether to apply `curves`. Defaults to on; the measurement is kept when
   *  the user turns it off, so turning it back on needs no re-detection. */
  curvesEnabled?: boolean;
  /** Downscaled image bytes kept so the page can be persisted to IndexedDB
   *  (the object URL in `src` does not survive a reload). Optional to keep the
   *  in-memory page shape light; set when a page is created/imported. */
  image?: ArrayBuffer;
  /** MIME type of `image` (default image/jpeg). */
  mime?: string;
}

export interface PdfOptions {
  quality: number;
  /** Export resolution in DPI (default 200). The PDF page size stays the paper
   *  size in points; the rendered image is only denser, so text stays sharp. */
  dpi: number;
}
