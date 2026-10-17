"use client";

import * as React from "react";
import { warpPoly } from "@/lib/image";
import { paperLabel } from "@/lib/paper";
import { activeCurves } from "@/lib/types";
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
 *
 * Only pages near the viewport are rendered, and a page drops its rendered image
 * again once it scrolls away. A 53-page document would otherwise mount 53 sheets
 * here AND 53 thumbnails in the grid, keeping ~100 decoded previews alive and
 * putting every one of them through the warp at once — which is what killed the
 * tab on iOS. Together with the shared render slots (lib/render-queue.ts) and the
 * decoded-source cache (lib/image.ts), how long the document is no longer
 * decides how much memory it takes.
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
  const hostRef = React.useRef<HTMLDivElement>(null);
  // Without an IntersectionObserver (very old browsers) every page counts as in
  // range, which is the previous behaviour.
  const [nearView, setNearView] = React.useState(
    () => typeof IntersectionObserver === "undefined",
  );
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
        c: page.curves,
        ce: page.curvesEnabled,
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
      page.curves,
      page.curvesEnabled,
    ],
  );

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setNearView(entries.some((e) => e.isIntersecting)),
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    // Out of range: nothing to render. The image element is unmounted below too,
    // which is what actually releases the decoded preview — no state to clear,
    // and the string stays ready for when the page scrolls back into range.
    if (!nearView) return;
    let active = true;
    const timer = setTimeout(() => {
      if (!active) return;
      // warpPoly takes a render slot itself, so this must NOT wrap it in another
      // one: two nesting callers would each hold a slot while waiting for a
      // second, and the queue would wedge with nothing ever rendering.
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
        curves: activeCurves(page),
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
  }, [nearView, page.src, deps, maxDim, debounceMs]);

  return (
    <div
      ref={hostRef}
      className={cn("flex h-full w-full min-h-0 flex-col items-center gap-1.5", className)}
    >
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {nearView && shot ? (
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
