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
  /** Apply a light unsharp mask for extra crispness. */
  sharpen?: boolean;
  /** Rotate the whole page clockwise before the perspective warp. */
  rotation?: Rotate;
  /** Page-curl dewarp strength in [-1, 1]; 0/undefined = off. Positive flattens
   *  a page bulging toward the camera, negative the opposite. */
  dewarpStrength?: number;
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
