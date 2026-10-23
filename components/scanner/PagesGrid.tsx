"use client";

import { PagePreview } from "./PagePreview";
import type { ScanPage } from "@/lib/types";
import { IconButton } from "@/components/ui/icon-button";
import { ChevronDown, ChevronUp, Pencil, RotateCw, Trash2 } from "lucide-react";

/**
 * The document so far, as sheets on the scanner bed.
 *
 * Each cell is one page: the sheet (tap to edit), the paper size it will print
 * at, and the actions that act on it. Order is real information in a scanned
 * document — page 1 is the first sheet of the PDF — so the index is stated
 * explicitly rather than implied by position, and the reorder controls sit
 * over the sheet where a drag would happen on desktop.
 */
export function PagesGrid({
  pages,
  onEdit,
  onDelete,
  onMove,
  onRotate,
}: {
  pages: ScanPage[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRotate: (id: string) => void;
}) {
  if (pages.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {pages.map((page, index) => {
        const isFirst = index === 0;
        const isLast = index === pages.length - 1;
        return (
          <div
            key={page.id}
            className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card"
          >
            {/* The cell sets the size and the sheet is taken out of flow inside
                it: otherwise a tall page's natural height would stretch the cell
                past its aspect ratio (and past `max-h-full`, whose percentage
                needs a definite height to resolve against), leaving the grid
                ragged. The sheet keeps its real paper ratio within the cell, so
                nothing is cropped whatever size the page is. */}
            <div className="bed relative aspect-[3/4] w-full">
              <button
                type="button"
                onClick={() => onEdit(page.id)}
                aria-label={`Chỉnh sửa trang ${index + 1}`}
                className="absolute inset-0 flex items-center justify-center p-2.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="flex h-full w-full items-center justify-center">
                  <PagePreview page={page} className="h-full w-full" showLabel={false} />
                </span>
              </button>

              {/* Reorder. Kept visible on touch (there is no hover) and faded in
                  on pointer devices so the sheet stays the focus. */}
              {pages.length > 1 && (
                <div className="absolute right-1.5 top-1.5 z-20 flex flex-col gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <IconButton
                    aria-label={`Đưa trang ${index + 1} lên trước`}
                    tone="overlay"
                    className="h-7 w-7"
                    disabled={isFirst}
                    onClick={() => onMove(page.id, -1)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    aria-label={`Đưa trang ${index + 1} xuống sau`}
                    tone="overlay"
                    className="h-7 w-7"
                    disabled={isLast}
                    onClick={() => onMove(page.id, 1)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </IconButton>
                </div>
              )}
            </div>

            <div className="flex h-10 items-center gap-1 border-t border-border pl-3 pr-1">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <IconButton
                  aria-label={`Xoay trang ${index + 1}`}
                  className="h-8 w-8"
                  onClick={() => onRotate(page.id)}
                >
                  <RotateCw className="h-4 w-4" />
                </IconButton>
                <IconButton
                  aria-label={`Xóa trang ${index + 1}`}
                  tone="danger"
                  className="h-8 w-8"
                  onClick={() => onDelete(page.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
                <IconButton
                  aria-label={`Chỉnh sửa trang ${index + 1}`}
                  className="h-8 w-8"
                  onClick={() => onEdit(page.id)}
                >
                  <Pencil className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
