"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { PAPER_OPTIONS, commonPaper, paperFor } from "@/lib/paper";
import type { PaperShape, ScanPage } from "@/lib/types";

const MIXED = "__mixed__" as const;

/**
 * Set one paper size across every page.
 *
 * Picking a size only stages it — the user has to press "Áp dụng cho tất cả".
 * Applying on select change would rewrite the whole document on a single stray
 * tap, and there is no undo (the debounced autosave persists immediately). The
 * staged-but-not-applied state is announced on the button rather than left for
 * the user to infer.
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
  const dirty = choice !== current && choice !== MIXED;

  const options = PAPER_OPTIONS.map((opt) => ({
    value: opt.value as string,
    label: opt.label,
  }));
  if (current === MIXED) {
    options.unshift({ value: MIXED, label: "Hỗn hợp" });
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <Segmented
          label="Khổ giấy cho tất cả trang"
          value={choice}
          options={options}
          onChange={(next) => setStaged({ from: current, to: next })}
          size="sm"
          wrap="wrap"
          className="sm:flex-1 sm:[&>button]:h-9"
        />
        <Button
          variant={dirty ? "primary" : "outline"}
          disabled={!dirty}
          onClick={() => onApply(paperFor(choice as PaperShape["kind"], shared))}
          className="h-9 shrink-0 self-center rounded-full text-xs sm:self-stretch sm:rounded-full"
        >
          {dirty ? "Áp dụng cho tất cả" : "Đã áp dụng"}
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        A4 và Letter in mọi trang cùng khổ. Tự động giữ tỉ lệ riêng của từng trang.
      </p>
    </div>
  );
}
