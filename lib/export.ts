"use client";
import { buildPdfFromPages } from "./pdf";
import { canvasToBlob, warpPoly } from "./image";
import { createZip } from "./zip";
import { activeCurves } from "./types";
import type { ScanPage } from "./types";

export type ExportFormat = "pdf" | "png" | "jpeg";

export type ExportResult = {
  blob: Blob;
  filename: string;
  mime: string;
};

function sanitize(name: string): string {
  const s = (name || "trang").trim().replace(/[\\/:*?"<>|]/g, "_").trim();
  return s.slice(0, 80) || "trang";
}

/** Build the chosen export as a single downloadable blob (PDF / one image / a
 *  ZIP archive of images when there are several pages). */
export async function buildExport(
  pages: ScanPage[],
  format: ExportFormat,
  opts: { dpi: number; quality: number },
): Promise<ExportResult> {
  if (format === "pdf") {
    const { bytes, pageCount } = await buildPdfFromPages(pages, {
      quality: opts.quality,
      dpi: opts.dpi,
    });
    return {
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
      filename: `scanner-${pageCount}-trang.pdf`,
      mime: "application/pdf",
    };
  }

  const mime = format === "png" ? "image/png" : "image/jpeg";
  const ext = format === "png" ? "png" : "jpg";
  const renderScale = (opts.dpi ?? 200) / 72;
  const files: { name: string; data: Uint8Array<ArrayBuffer> }[] = [];

  for (const page of pages) {
    const { canvas } = await warpPoly({
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
    const blob = await canvasToBlob(canvas, opts.quality, mime);
    const data = new Uint8Array(await blob.arrayBuffer());
    files.push({ name: `${sanitize(page.name)}.${ext}`, data });
  }

  if (files.length === 1) {
    return {
      blob: new Blob([files[0].data], { type: mime }),
      filename: files[0].name,
      mime,
    };
  }
  const zipData = createZip(files);
  return {
    blob: new Blob([zipData], { type: "application/zip" }),
    filename: `scanner-${files.length}-trang.zip`,
    mime: "application/zip",
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Share via the Web Share API (mobile). Returns true when shared. */
export async function shareBlob(blob: Blob, filename: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };
  if (typeof nav.share !== "function") return false;
  const file = new File([blob], filename, { type: blob.type });
  if (nav.canShare && !nav.canShare({ files: [file] })) return false;
  try {
    await nav.share({ files: [file], title: filename });
    return true;
  } catch {
    return false;
  }
}

type SaveFileHandle = {
  createWritable: () => Promise<{
    write: (b: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

/** Save directly to disk via the File System Access API (desktop Chromium).
 *  Returns true when saved. */
export async function saveBlobToDisk(blob: Blob, filename: string): Promise<boolean> {
  const w = window as Window & {
    showSaveFilePicker?: (opts: object) => Promise<SaveFileHandle>;
  };
  if (typeof w.showSaveFilePicker !== "function") return false;
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: blob.type === "application/pdf" ? "PDF" : "Hình ảnh/ZIP",
          accept: { [blob.type]: [filename.split(".").pop()!] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}
