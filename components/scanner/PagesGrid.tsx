"use client";

import { PagePreview } from "./PagePreview";
import type { ScanPage } from "@/lib/types";
import { IconButton } from "@/components/ui/icon-button";
import { ChevronDown, ChevronUp, Pencil, RotateCw, Trash2 } from "lucide-react";

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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {pages.map((page, index) => {
        const isFirst = index === 0;
        const isLast = index === pages.length - 1;
        return (
          <div
            key={page.id}
            className="group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-2"
          >
            {/* The cell sets the size and the sheet is taken out of flow inside
                it: otherwise a tall page's natural height would stretch the cell
                past its aspect ratio (and past `max-h-full`, whose percentage
                needs a definite height to resolve against), leaving the grid
                ragged. The sheet keeps its real paper ratio within the cell, so
                nothing is cropped whatever size the page is. */}
            <button
              type="button"
              onClick={() => onEdit(page.id)}
              aria-label={`Chỉnh sửa trang ${index + 1}`}
              className="relative block aspect-[3/4] w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              <PagePreview page={page} className="absolute inset-0" />
            </button>

            <div className="flex items-center gap-1">
              <span className="px-1 text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <IconButton
                  aria-label="Xoay 90°"
                  className="h-8 w-8"
                  onClick={() => onRotate(page.id)}
                >
                  <RotateCw className="h-4 w-4" />
                </IconButton>
                <IconButton
                  aria-label="Xóa trang"
                  className="h-8 w-8"
                  onClick={() => onDelete(page.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
                <IconButton
                  aria-label="Chỉnh sửa"
                  className="h-8 w-8"
                  onClick={() => onEdit(page.id)}
                >
                  <Pencil className="h-4 w-4" />
                </IconButton>
              </div>
            </div>

            {pages.length > 1 && (
              <div className="absolute right-1 top-1 z-20 flex flex-col gap-1 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <IconButton
                  aria-label={`Di chuyển trang ${index + 1} lên`}
                  className="h-8 w-8 bg-black/55 text-white hover:bg-black/75"
                  disabled={isFirst}
                  onClick={() => onMove(page.id, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </IconButton>
                <IconButton
                  aria-label={`Di chuyển trang ${index + 1} xuống`}
                  className="h-8 w-8 bg-black/55 text-white hover:bg-black/75"
                  disabled={isLast}
                  onClick={() => onMove(page.id, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </IconButton>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
