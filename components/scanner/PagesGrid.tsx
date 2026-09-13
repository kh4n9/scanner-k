"use client";

import * as React from "react";
import Image from "next/image";
import { warpPoly } from "@/lib/image";
import type { ScanPage } from "@/lib/types";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Pencil, RotateCw, Trash2 } from "lucide-react";

function PageThumb({ page }: { page: ScanPage }) {
  const [src, setSrc] = React.useState<string | null>(null);
  const deps = React.useMemo(
    () =>
      JSON.stringify({
        b: page.boundary,
        p: page.paper,
        f: page.filter,
        a: page.adjust,
        s: page.shadow,
        sh: page.sharpen,
        r: page.rotation,
        d: page.dewarpStrength,
      }),
    [page.boundary, page.paper, page.filter, page.adjust, page.shadow, page.sharpen, page.rotation, page.dewarpStrength],
  );

  React.useEffect(() => {
    let active = true;
    warpPoly({
      src: page.src,
      boundary: page.boundary,
      paper: page.paper,
      filter: page.filter,
      adjust: page.adjust,
      shadow: page.shadow,
      sharpen: page.sharpen,
      rotation: page.rotation ?? 0,
      dewarpStrength: page.dewarpStrength ?? 0,
      maxDim: 480,
    })
      .then(({ canvas }) => {
        if (active) setSrc(canvas.toDataURL("image/jpeg", 0.85));
      })
      .catch(() => setSrc(null));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.src, deps]);

  if (!src) {
    return (
      <div className="aspect-[3/4] w-full animate-pulse rounded-lg bg-muted" />
    );
  }
  return (
    <Image
      src={src}
      alt={`Trang ${page.name}`}
      width={480}
      height={640}
      unoptimized
      className="aspect-[3/4] h-auto w-full rounded-lg bg-card object-cover"
      draggable={false}
    />
  );
}

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
            <PageThumb page={page} />

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

            <div
              className={cn(
                "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-col gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100",
                pages.length > 1 && "flex",
              )}
            >
              <IconButton
                aria-label="Lên"
                className="h-9 w-9 bg-black/60 text-white hover:bg-black/80"
                disabled={isFirst}
                onClick={() => onMove(page.id, -1)}
              >
                <ChevronUp className="h-4 w-4" />
              </IconButton>
              <IconButton
                aria-label="Xuống"
                className="h-9 w-9 bg-black/60 text-white hover:bg-black/80"
                disabled={isLast}
                onClick={() => onMove(page.id, 1)}
              >
                <ChevronDown className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
