"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PagePreview } from "./PagePreview";
import { PaperBulkControl } from "./PaperBulkControl";
import { paperLabel, paperLabels, commonPaper } from "@/lib/paper";
import { FileDown } from "lucide-react";
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
    ? `${paperLabel(shared)}`
    : `Khổ hỗn hợp — ${paperLabels(pages).join(", ")}`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Xem trước tài liệu"
      description={`${pages.length} trang · ${summary}`}
      className="sm:max-w-3xl"
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={pages.length === 0}
          onClick={onExport}
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          {pages.length > 0 ? `Xuất PDF · ${pages.length} trang` : "Xuất PDF"}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <PaperBulkControl pages={pages} onApply={onApplyPaperToAll} />

        <div className="grid grid-cols-2 gap-3 border-t border-border pt-5 sm:grid-cols-3">
          {pages.map((page, index) => (
            <figure key={page.id} className="flex flex-col gap-1.5">
              <div className="bed h-56 rounded-lg p-2.5">
                <PagePreview page={page} maxDim={640} />
              </div>
              <figcaption className="text-center font-mono text-[11px] tabular-nums text-muted-foreground">
                Trang {index + 1}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
