"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { PAPER_OPTIONS, commonPaper, paperFor } from "@/lib/paper";
import type { PaperShape, ScanPage } from "@/lib/types";

const MIXED = "__mixed__";

/**
 * Set one paper size across every page.
 *
 * Picking a size only stages it — the user has to press "Áp dụng cho tất cả".
 * Applying on select change would rewrite the whole document on a single stray
 * tap, and there is no undo (the debounced autosave persists immediately).
 */
export function PaperBulkControl({
  pages,
  onApply,
  className,
}: {
  pages: ScanPage[];
  onApply: (paper: PaperShape) => void;
  className?: string;
}) {
  const shared = commonPaper(pages);
  const current = shared?.kind ?? MIXED;
  // A staged pick is only meaningful while it differs from what the document
  // has; once the document moves (because we applied it, or because something
  // else changed the pages) this falls back to the document's own value. Kept as
  // derived state rather than mirrored in an effect, which would cascade renders.
  const [staged, setStaged] = React.useState<{ from: string; to: string } | null>(null);
  const choice = staged && staged.from === current ? staged.to : current;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Khổ giấy cho tất cả trang"
          className="h-9 flex-1 rounded-lg border border-border bg-transparent px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={choice}
          onChange={(e) => setStaged({ from: current, to: e.target.value })}
        >
          {shared === null && (
            <option value={MIXED} disabled>
              Khổ giấy hỗn hợp
            </option>
          )}
          {PAPER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          size="sm"
          disabled={choice === current}
          onClick={() => onApply(paperFor(choice as PaperShape["kind"], shared))}
        >
          Áp dụng cho tất cả
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        A4 và Letter cho mọi trang cùng khổ. Tự động thì mỗi trang theo tỉ lệ riêng của nó.
      </p>
    </div>
  );
}
