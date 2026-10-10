import type { PaperShape, ScanPage } from "./types";

/** Paper sizes offered in the UI, in display order. */
export const PAPER_OPTIONS: { value: PaperShape["kind"]; label: string }[] = [
  { value: "auto", label: "Tự động" },
  { value: "a4", label: "A4" },
  { value: "letter", label: "Letter" },
  { value: "custom", label: "Tùy chỉnh" },
];

/** Dimensions used when "Tùy chỉnh" is picked without existing ones — A4 in mm. */
export const DEFAULT_CUSTOM_MM = { widthMm: 210, heightMm: 297 };

export function paperLabel(paper: PaperShape): string {
  switch (paper.kind) {
    case "a4":
      return "A4";
    case "letter":
      return "Letter";
    case "custom":
      return `${paper.widthMm}×${paper.heightMm}mm`;
    default:
      return "Tự động";
  }
}

function samePaper(a: PaperShape, b: PaperShape): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "custom" && b.kind === "custom") {
    return a.widthMm === b.widthMm && a.heightMm === b.heightMm;
  }
  return true;
}

/**
 * The paper size shared by every page, or null when they differ — which is the
 * "mixed" state the bulk control and the preview summary need to show. Note that
 * per-page `auto` can still produce different *dimensions* while every page
 * reports the same `auto` kind; that is not mixed, it is reported as auto.
 */
export function commonPaper(pages: ScanPage[]): PaperShape | null {
  if (pages.length === 0) return null;
  const first = pages[0].paper;
  return pages.every((p) => samePaper(p.paper, first)) ? first : null;
}

/** Distinct paper labels across pages, for the "mixed" summary line. */
export function paperLabels(pages: ScanPage[]): string[] {
  const out: string[] = [];
  for (const p of pages) {
    const label = paperLabel(p.paper);
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** Build the paper for a chosen kind, keeping existing custom dimensions. */
export function paperFor(kind: PaperShape["kind"], shared: PaperShape | null): PaperShape {
  if (kind === "custom") {
    return shared?.kind === "custom" ? shared : { kind: "custom", ...DEFAULT_CUSTOM_MM };
  }
  return { kind } as PaperShape;
}
