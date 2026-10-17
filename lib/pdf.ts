import { PDFDocument } from "pdf-lib";
import { activeCurves } from "./types";
import type { PdfOptions, ScanPage } from "./types";
import { canvasToBlob, warpPoly } from "./image";

export async function buildPdfFromPages(
  pages: ScanPage[],
  options: PdfOptions,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const doc = await PDFDocument.create();
  // 1 PDF point = 1/72". Rendering at more pixels per point gives a denser scan
  // while keeping the page size fixed to the chosen paper.
  const renderScale = (options.dpi ?? 200) / 72;

  for (const page of pages) {
    const { canvas, width, height } = await warpPoly({
      src: page.src,
      boundary: page.boundary,
      paper: page.paper,
      filter: page.filter,
      adjust: page.adjust,
      shadow: page.shadow,
      sharpen: page.sharpen,
      rotation: page.rotation ?? 0,
      dewarpStrength: page.dewarpStrength ?? 0,
      curves: activeCurves(page),
      renderScale,
    });

    const blob = await canvasToBlob(canvas, options.quality);
    const jpg = await doc.embedJpg(await blob.arrayBuffer());

    // The page is exactly the warped document — filled edge-to-edge, no border.
    const pdfPage = doc.addPage([width, height]);
    pdfPage.drawImage(jpg, { x: 0, y: 0, width, height });
  }

  const bytes = await doc.save();
  return { bytes, pageCount: pages.length };
}
