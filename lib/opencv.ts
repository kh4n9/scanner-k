"use client";
// Bundled OpenCV.js via @techstark/opencv-js. The whole OpenCV runtime is now
// part of the app bundle, so document detection works fully offline — the image
// and all processing stay on the device (no upload, no CDN dependency).
import type { CV, Mat } from "@techstark/opencv-js";
import cvModule from "@techstark/opencv-js";
import { clamp, loadImage } from "./image";
import type { Point } from "./types";

type RuntimeCv = CV & { onRuntimeInitialized?: () => void };

async function getOpenCv(): Promise<CV> {
  // The module may be a promise (unresolved wasm) or the ready cv object.
  const cv = ((cvModule instanceof Promise ? await cvModule : cvModule) as CV);
  // OpenCV sets `cv.Mat` before the WASM runtime is callable, so probe a method
  // that actually touches the runtime to confirm readiness.
  try {
    cv.getBuildInformation();
    return cv;
  } catch {
    // not ready yet — wait for the runtime-init hook
  }
  await new Promise<void>((resolve) => {
    (cv as RuntimeCv).onRuntimeInitialized = () => resolve();
  });
  return cv;
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

/** From a binary mask, take the largest contour and return its corner quad. */
function cornersFromMask(
  cv: CV,
  mask: Mat,
  W: number,
  H: number,
): { pts: { x: number; y: number }[]; area: number } | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let best: { pts: { x: number; y: number }[]; area: number } | null = null;
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
        best = { pts: corners, area };
      }
    }
    cnt.delete();
  }
  contours.delete();
  hierarchy.delete();
  return best;
}

/** Detect the document quad using OpenCV. Returns 4 normalized (0..1) corners. */
export async function detectWithOpenCv(src: string): Promise<Point[]> {
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
  let best: { pts: { x: number; y: number }[]; area: number } | null = null;
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
    return cornersFromPoints(best.pts).map((p) => ({
      x: clamp(p.x / W, 0, 1),
      y: clamp(p.y / H, 0, 1),
    }));
  }
  throw new Error("Không tìm thấy vùng phiếu (OpenCV).");
}
