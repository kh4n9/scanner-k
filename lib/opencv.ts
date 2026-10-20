"use client";
// Bundled OpenCV.js via @techstark/opencv-js, loaded on demand (see `getOpenCv`).
// Document detection works fully offline — the image and all processing stay on
// the device (no upload, no CDN dependency).
import type { CV, Mat } from "@techstark/opencv-js";
import { clamp, loadImage } from "./image";
import { measureEdgeCurves } from "./image-pixels";
import type { DetectResult } from "./types";

async function getOpenCv(): Promise<CV> {
  // Imported here rather than at module scope: the OpenCV runtime is ~24 MB of
  // JS and is reached only through the "Tự dò (CV)" button. A static import put
  // it in the initial /scan bundle — every visitor downloaded and parsed it
  // before they could use the scanner at all.
  const { default: cvModule } = await import("@techstark/opencv-js");
  // The module may be a promise (unresolved wasm) or the ready cv object.
  const cv = ((cvModule instanceof Promise ? await cvModule : cvModule) as CV);
  // OpenCV sets `cv.Mat` before the WASM runtime is callable, so probe a method
  // that actually touches the runtime to confirm readiness.
  try {
    cv.getBuildInformation();
    return cv;
  } catch {
    // Not ready yet — fall through and wait.
  }
  // The runtime-init hook can already have fired before this handler was
  // attached (the import above may resolve after initialisation), and waiting on
  // it then would park here forever: the button would spin with no error and no
  // way out. Poll the same probe instead, so readiness is detected either way,
  // and give up with a real error rather than hanging indefinitely.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      cv.getBuildInformation();
      return cv;
    } catch {
      // still initialising
    }
  }
  throw new Error("OpenCV chưa sẵn sàng — hãy thử lại sau giây lát.");
}

/** Pick the 4 extreme corners (TL/TR/BR/BL) of a convex point set — no approx needed. */
function cornersFromPoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  let tl = points[0];
  let tr = points[0];
  let br = points[0];
  let bl = points[0];
  for (const p of points) {
    const s = p.x + p.y;
    const d = p.x - p.y;
    if (s < tl.x + tl.y) tl = p;
    if (s > br.x + br.y) br = p;
    if (d > tr.x - tr.y) tr = p;
    if (d < bl.x - bl.y) bl = p;
  }
  return [tl, tr, br, bl];
}

/** Shoelace area of a polygon — used to reject degenerate (near-line) quads. */
function polyArea(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

/** The largest contour of a binary mask, with both its raw outline (which the
 *  curvature measurement needs) and the 4-corner quad derived from it. */
type MaskShape = {
  contour: { x: number; y: number }[];
  corners: { x: number; y: number }[];
  area: number;
};

/** From a binary mask, take the largest contour and return its outline + quad. */
function cornersFromMask(cv: CV, mask: Mat, W: number, H: number): MaskShape | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let best: MaskShape | null = null;
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area < 0.02 * W * H) {
      cnt.delete();
      continue;
    }
    const n = cnt.rows;
    if (n >= 4 && cnt.data32S) {
      const pts: { x: number; y: number }[] = [];
      for (let r = 0; r < n; r++) pts.push({ x: cnt.data32S[r * 2], y: cnt.data32S[r * 2 + 1] });
      const corners = cornersFromPoints(pts);
      if (polyArea(corners) > 0.001 * W * H && (!best || area > best.area)) {
        best = { contour: pts, corners, area };
      }
    }
    cnt.delete();
  }
  contours.delete();
  hierarchy.delete();
  return best;
}

/** Detect the document using OpenCV: the 4 normalized (0..1) corners plus how
 *  far each edge bows away from the straight chord between them. */
export async function detectWithOpenCv(src: string): Promise<DetectResult> {
  const cv = await getOpenCv();
  const image = await loadImage(src);
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.getContext("2d")!.drawImage(image, 0, 0);

  const srcMat = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  let best: MaskShape | null = null;
  try {
    cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    // Strategy 1: Canny edges (dilated to close gaps) → largest contour corners.
    const edges = new cv.Mat();
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    try {
      cv.Canny(blurred, edges, 40, 120);
      cv.dilate(edges, edges, kernel);
      best = cornersFromMask(cv, edges, W, H);
    } finally {
      kernel.delete();
      edges.delete();
    }

    // Strategy 2 (fallback): adaptive threshold for uneven lighting/contrast.
    if (!best) {
      const bin = new cv.Mat();
      const k2 = cv.Mat.ones(3, 3, cv.CV_8U);
      try {
        cv.adaptiveThreshold(blurred, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 51, 10);
        cv.dilate(bin, bin, k2);
        best = cornersFromMask(cv, bin, W, H);
      } finally {
        k2.delete();
        bin.delete();
      }
    }
  } finally {
    gray.delete();
    blurred.delete();
    srcMat.delete();
  }

  if (best) {
    return {
      boundary: best.corners.map((p) => ({
        x: clamp(p.x / W, 0, 1),
        y: clamp(p.y / H, 0, 1),
      })),
      // Measured on the raw contour, in full source pixels — the same space the
      // corners are in, so the sagitta is a pure ratio of the edge length.
      curves: measureEdgeCurves(best.contour, best.corners),
    };
  }
  throw new Error("Không tìm thấy vùng phiếu (OpenCV).");
}
