"use client";

import * as React from "react";
import { warpPoly } from "@/lib/image";
import { paperLabel } from "@/lib/paper";
import type { ScanPage } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One page drawn as a sheet of paper: white, thin border, soft shadow, tagged
 * with its paper size.
 *
 * The sheet keeps its TRUE aspect ratio and is never cropped. The ratio comes
 * from the warp output's own dimensions, so it is right for every paper kind —
 * including per-page `auto`, where each page can have a different shape. The
 * image is sized by `max-h-full max-w-full` on a replaced element, so the
 * browser scales it down preserving its intrinsic ratio and the border hugs the
 * page. That is what the previous hand-rolled thumbnails got wrong: a hard-coded
 * `aspect-[3/4]` with `object-cover` cropped Letter and landscape pages.
 *
 * Shared by the page grid, the editor preview and the document preview so those
 * three can never disagree. Give the caller-supplied box a definite height (an
 * `aspect-*` cell, a `h-*` wrapper) and the sheet fills it as far as its ratio
 * allows.
 */
export function PagePreview({
  page,
  maxDim = 480,
  debounceMs = 0,
  showLabel = true,
  className,
}: {
  page: ScanPage;
  maxDim?: number;
  /** Delay before re-rendering, for surfaces the user edits continuously (a
   *  slider drag would otherwise kick off a warp on every change event). */
  debounceMs?: number;
  showLabel?: boolean;
  className?: string;
}) {
  const [shot, setShot] = React.useState<string | null>(null);
  // Re-render only when something that changes the rendered pixels changes.
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
    [
      page.boundary,
      page.paper,
      page.filter,
      page.adjust,
      page.shadow,
      page.sharpen,
      page.rotation,
      page.dewarpStrength,
    ],
  );

  React.useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
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
        maxDim,
      })
        .then(({ canvas }) => {
          if (active) setShot(canvas.toDataURL("image/jpeg", 0.85));
        })
        .catch(() => {
          if (active) setShot(null);
        });
    }, debounceMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.src, deps, maxDim, debounceMs]);

  return (
    <div className={cn("flex h-full w-full min-h-0 flex-col items-center gap-1.5", className)}>
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {shot ? (
          // The source is a data URL rendered locally on a canvas, so there is no
          // remote image for next/image to optimise; a plain img also keeps the
          // intrinsic paper ratio, which is what lets the sheet fit uncropped.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shot}
            alt={`Trang ${page.name}`}
            draggable={false}
            className="max-h-full max-w-full select-none rounded-lg border border-border bg-white shadow-sm"
          />
        ) : (
          <div className="aspect-[3/4] h-full max-h-full animate-pulse rounded-lg bg-muted" />
        )}
      </div>
      {showLabel && (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {paperLabel(page.paper)}
        </span>
      )}
    </div>
  );
}
