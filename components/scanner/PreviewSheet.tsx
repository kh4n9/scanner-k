"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PagePreview } from "./PagePreview";
import { PaperBulkControl } from "./PaperBulkControl";
import { commonPaper, paperLabel, paperLabels } from "@/lib/paper";
import type { PaperShape, ScanPage } from "@/lib/types";

/**
 * Review the whole document as sheets of paper before exporting: every page at
 * its real paper shape (so a stretched or mismatched page is visible), plus the
 * bulk paper control, which is the natural place to fix one.
 */
export function PreviewSheet({
  open,
  onClose,
  pages,
  onApplyPaperToAll,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  pages: ScanPage[];
  onApplyPaperToAll: (paper: PaperShape) => void;
  onExport: () => void;
}) {
  const shared = commonPaper(pages);
  const summary = shared
    ? `${pages.length} trang · ${paperLabel(shared)}`
    : `${pages.length} trang · Khổ giấy hỗn hợp (${paperLabels(pages).join(", ")})`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Xem trước tài liệu"
      className="sm:max-w-3xl"
      footer={
        <Button size="lg" className="w-full" disabled={pages.length === 0} onClick={onExport}>
          {pages.length > 0 ? `Xuất PDF (${pages.length})` : "Xuất PDF"}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <p className="text-sm text-muted-foreground">{summary}</p>

        <PaperBulkControl pages={pages} onApply={onApplyPaperToAll} />

        <div className="grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-3">
          {pages.map((page, index) => (
            <figure key={page.id} className="flex flex-col gap-2">
              <div className="h-56 rounded-xl border border-border bg-card p-2">
                <PagePreview page={page} maxDim={640} />
              </div>
              <figcaption className="text-center text-xs tabular-nums text-muted-foreground">
                Trang {index + 1}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
