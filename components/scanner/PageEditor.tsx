"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Range } from "@/components/ui/range";
import {
  AlignVerticalJustifyCenter,
  Check,
  Loader2,
  Plus,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  clamp,
  computeAutoAdjust,
  detectDocBoundary,
  loadImage,
} from "@/lib/image";
import { detectWithOpenCv } from "@/lib/opencv";
import { PAPER_OPTIONS, DEFAULT_CUSTOM_MM, paperFor } from "@/lib/paper";
import type {
  Adjust,
  EdgeCurves,
  FilterMode,
  PaperShape,
  Point,
  Rotate,
  ScanPage,
} from "@/lib/types";
import { DEFAULT_SHARPEN, NEUTRAL_ADJUST } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PagePreview } from "./PagePreview";

const FILTERS: { value: FilterMode; label: string }[] = [
  { value: "original", label: "Gốc" },
  { value: "color", label: "Màu" },
  { value: "grayscale", label: "Xám" },
  { value: "bw", label: "Đen trắng" },
];

/** Measured edge bow, written the way the scale in an instrument would be. */
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

const PRESET_ADJUST: Record<"original" | "color", Adjust> = {
  original: NEUTRAL_ADJUST,
  color: { brightness: 1, contrast: 1.08, saturation: 1.12 },
};

export function PageEditor({
  page,
  open,
  onApply,
  onApplyToAll,
  onClose,
}: {
  page: ScanPage;
  open: boolean;
  onApply: (patch: Partial<ScanPage>) => void;
  /** Push the paper size being edited out to every page in the document. */
  onApplyToAll: (paper: PaperShape) => void;
  onClose: () => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [nat, setNat] = React.useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = React.useState<{ w: number; h: number } | null>(null);
  const [boundary, setBoundary] = React.useState<Point[]>(() =>
    page.boundary && page.boundary.length >= 4
      ? page.boundary.map((p) => ({ ...p }))
      : [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
  );
  const [paper, setPaper] = React.useState<PaperShape>(page.paper ?? { kind: "auto" });
  const [filter, setFilter] = React.useState<FilterMode>(page.filter ?? "original");
  const [adjust, setAdjust] = React.useState<Adjust>(page.adjust ?? NEUTRAL_ADJUST);
  const [shadow, setShadow] = React.useState(page.shadow ?? false);
  const [sharpen, setSharpen] = React.useState(page.sharpen ?? false);
  const [sharpenStrength, setSharpenStrength] = React.useState(
    page.sharpenStrength ?? DEFAULT_SHARPEN,
  );
  const [rotation, setRotation] = React.useState<Rotate>(page.rotation ?? 0);
  const [dewarpStrength, setDewarpStrength] = React.useState(page.dewarpStrength ?? 0);
  // Measured when the boundary was detected; the toggle below only decides
  // whether the warp uses it, so turning it back on needs no re-detection.
  const [curves, setCurves] = React.useState<EdgeCurves>(page.curves ?? [0, 0, 0, 0]);
  const [curvesEnabled, setCurvesEnabled] = React.useState(page.curvesEnabled ?? true);
  const [dragging, setDragging] = React.useState<number | null>(null);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [detectBusy, setDetectBusy] = React.useState(false);
  const [cvBusy, setCvBusy] = React.useState(false);
  const [cvError, setCvError] = React.useState<string | null>(null);
  const [autoBusy, setAutoBusy] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    loadImage(page.src)
      .then((img) => {
        if (active) setNat({ w: img.naturalWidth, h: img.naturalHeight });
      })
      .catch(() => setNat(null));
    return () => {
      active = false;
    };
  }, [page.src]);

  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = box && nat ? Math.min(box.w / nat.w, box.h / nat.h) : 1;
  const dispW = nat ? nat.w * scale : 0;
  const dispH = nat ? nat.h * scale : 0;
  const offX = box ? (box.w - dispW) / 2 : 0;
  const offY = box ? (box.h - dispH) / 2 : 0;

  const toDisplay = (pt: Point): Point => ({
    x: offX + pt.x * dispW,
    y: offY + pt.y * dispH,
  });

  const polygonPoints = React.useMemo(
    () => boundary.map((p) => toDisplay(p)).map((p) => `${p.x},${p.y}`).join(" "),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boundary, dispW, dispH, offX, offY],
  );

  // Interior guide grid: bilinear on the 4 outer corners, so it deforms
  // evenly (and automatically) as the border stretches. Not interactive.
  const gridLines = React.useMemo(() => {
    const empty = { lines: [] as string[], ext: null as Record<"tl" | "tr" | "br" | "bl", Point> | null };
    if (!nat || !box || boundary.length < 4) return empty;
    const ext = { tl: boundary[0], tr: boundary[0], br: boundary[0], bl: boundary[0] };
    let minSum = Infinity,
      maxSum = -Infinity,
      minDiff = Infinity,
      maxDiff = -Infinity;
    for (const p of boundary) {
      const s = p.x + p.y;
      const dd = p.x - p.y;
      if (s < minSum) {
        minSum = s;
        ext.tl = p;
      }
      if (s > maxSum) {
        maxSum = s;
        ext.br = p;
      }
      if (dd < minDiff) {
        minDiff = dd;
        ext.bl = p;
      }
      if (dd > maxDiff) {
        maxDiff = dd;
        ext.tr = p;
      }
    }
    const tl = toDisplay(ext.tl);
    const tr = toDisplay(ext.tr);
    const br = toDisplay(ext.br);
    const bl = toDisplay(ext.bl);
    const lerp = (a: Point, b: Point, t: number): Point => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    const bil = (u: number, v: number): Point =>
      lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
    const D = 6;
    const lines: string[] = [];
    for (let t = 1; t < D; t++) {
      const v = t / D;
      const pts: string[] = [];
      for (let s = 0; s <= D; s++) {
        const p = bil(s / D, v);
        pts.push(`${p.x},${p.y}`);
      }
      lines.push(pts.join(" "));
    }
    for (let t = 1; t < D; t++) {
      const u = t / D;
      const pts: string[] = [];
      for (let s = 0; s <= D; s++) {
        const p = bil(u, s / D);
        pts.push(`${p.x},${p.y}`);
      }
      lines.push(pts.join(" "));
    }
    return { lines, ext: { tl, tr, br, bl } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary, nat, box, dispW, dispH, offX, offY]);

  // The four edges as they will actually be warped: a quadratic bow matching
  // the measured sagitta, drawn dashed over the photo so it is visible whether
  // a curl was found, and where. Same construction as `curvedEdge` in
  // lib/image.ts, in display coordinates.
  const curvePaths = React.useMemo(() => {
    const ext = gridLines.ext;
    if (!ext || boundary.length !== 4 || !curves.some((c) => c !== 0)) return [];
    const { tl, tr, br, bl } = ext;
    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;
    const edge = (a: Point, b: Point, s: number): string | null => {
      if (Math.abs(s) < 0.004) return null;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) return null;
      let nx = -dy / len;
      let ny = dx / len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if ((cx - mx) * nx + (cy - my) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      return `M ${a.x} ${a.y} Q ${mx + 2 * s * len * nx} ${my + 2 * s * len * ny} ${b.x} ${b.y}`;
    };
    return [
      edge(tl, tr, curves[0]),
      edge(tr, br, curves[1]),
      edge(bl, br, curves[2]),
      edge(tl, bl, curves[3]),
    ].filter((d): d is string => d !== null);
  }, [gridLines, curves, boundary.length]);

  const updatePoint = React.useCallback(
    (index: number, px: number, py: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clamp((px - rect.left - offX) / dispW, 0, 1);
      const y = clamp((py - rect.top - offY) / dispH, 0, 1);
      setBoundary((b) => b.map((p, i) => (i === index ? { x, y } : p)));
    },
    [dispW, dispH, offX, offY],
  );

  const startDrag = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(index);
    setSelected(index);
  };
  const moveDrag = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging !== index) return;
    updatePoint(index, e.clientX, e.clientY);
  };

  const addMidpoint = (index: number) => {
    setBoundary((b) => {
      const a = b[index];
      const c = b[(index + 1) % b.length];
      const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      const next = [...b];
      next.splice(index + 1, 0, mid);
      return next;
    });
  };

  const removeSelected = () => {
    if (selected === null) return;
    setBoundary((b) => (b.length > 4 ? b.filter((_, i) => i !== selected) : b));
    setSelected(null);
  };

  const autoDetectBoundary = async () => {
    setDetectBusy(true);
    try {
      const next = await detectDocBoundary(page.src);
      setBoundary(next.boundary);
      setCurves(next.curves);
    } catch {
      // keep current
    } finally {
      setDetectBusy(false);
    }
  };

  const autoDetectBoundaryCv = async () => {
    setCvBusy(true);
    setCvError(null);
    try {
      const next = await detectWithOpenCv(page.src);
      setBoundary(next.boundary);
      setCurves(next.curves);
    } catch (e) {
      setCvError(e instanceof Error ? e.message : "Không dò được (OpenCV).");
    } finally {
      setCvBusy(false);
    }
  };

  const autoColor = async () => {
    setAutoBusy(true);
    try {
      const res = await computeAutoAdjust(page.src);
      setFilter("original");
      setAdjust(res.adjust);
      setShadow(res.shadow);
    } catch {
      // ignore
    } finally {
      setAutoBusy(false);
    }
  };

  const rotate90 = () =>
    setRotation((r) => (((r + 90) % 360) as Rotate));

  // Lightweight auto-orientation: document papers are portrait by default
  // (auto/A4/Letter), so if the detected bounding box is wide (landscape in the
  // photo) we rotate 90° so the page reads upright. It can't tell 0 vs 180 or
  // 90 vs 270 (that needs content analysis/OCR), so use the manual rotate to
  // fine-tune.
  const autoRotate = () => {
    const xs = boundary.map((p) => p.x);
    const ys = boundary.map((p) => p.y);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    const landscapeDoc = Math.abs(bw - bh) > 0.02 && bw > bh;
    // 90 and 270 give the same aspect, so this cannot tell them apart from the
    // boundary alone. Keep whichever sideways orientation the user already
    // chose instead of silently flipping the page upside down on a second tap.
    setRotation((r) => (landscapeDoc ? (r === 270 ? 270 : 90) : 0));
  };

  // The page as it is being edited, so the preview reflects uncommitted changes.
  // PagePreview owns the rendering, which is why this no longer keeps its own
  // warpPoly preview state.
  const draft = React.useMemo<ScanPage>(
    () => ({
      ...page,
      boundary,
      paper,
      filter,
      adjust,
      shadow,
      sharpen,
      sharpenStrength,
      rotation,
      dewarpStrength,
      curves,
      curvesEnabled,
    }),
    [
      page,
      boundary,
      paper,
      filter,
      adjust,
      shadow,
      sharpen,
      sharpenStrength,
      rotation,
      dewarpStrength,
      curves,
      curvesEnabled,
    ],
  );

  // Nothing measured yet (a page added before this feature, or a straight-edged
  // document): the toggle has nothing to switch, so it shows as unavailable.
  const hasCurves = curves.some((c) => c !== 0);

  const setCustomPaper = (w: number, h: number) => {
    // An emptied number input gives "" → 0 and a half-typed one gives NaN, and
    // `paperDims` only guards with `Math.max(1, w)` — which happily propagates
    // NaN into the canvas size and makes `createImageData` throw. Clamp to the
    // range the inputs advertise, and fall back to A4 for a value that isn't a
    // number at all.
    const mm = (v: number, fallback: number) =>
      Number.isFinite(v) ? Math.min(600, Math.max(40, Math.round(v))) : fallback;
    setPaper({
      kind: "custom",
      widthMm: mm(w, DEFAULT_CUSTOM_MM.widthMm),
      heightMm: mm(h, DEFAULT_CUSTOM_MM.heightMm),
    });
  };

  const applyPreset = (f: FilterMode) => {
    setFilter(f);
    setAdjust(f === "original" || f === "color" ? PRESET_ADJUST[f] : NEUTRAL_ADJUST);
  };

  const adjustField = (key: keyof Adjust, value: number) => {
    setAdjust((a) => ({ ...a, [key]: value }));
    setFilter("original");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Chỉnh trang"
      description="Kéo các điểm để bám đúng mép giấy, rồi chọn kiểu nâng cao."
      className="sm:max-w-2xl"
      // Cap the sheet on desktop so the crop surface and the first controls are
      // both on screen at once, instead of the photo filling the viewport.
      bodyClassName="sm:max-h-[calc(92dvh-6rem)]"
      footer={
        <Button
          size="lg"
          className="w-full"
          onClick={() =>
            onApply({
              boundary,
              paper,
              filter,
              adjust,
              shadow,
              sharpen,
              sharpenStrength,
              rotation,
              dewarpStrength,
              curves,
              curvesEnabled,
            })
          }
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Áp dụng
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {/* The crop surface is the scanner bed: the photo sits on black, and
            everything outside the boundary is dimmed so the page is the only
            lit thing on screen. */}
        <div
          ref={containerRef}
          className="bed relative h-[44dvh] min-h-64 w-full touch-none overflow-hidden rounded-xl border border-border sm:h-[34dvh]"
        >
          {nat && box && boundary.length >= 4 && (
            <>
              {/* The source is a blob URL rendered locally, so there is nothing
                  for next/image to optimise, and this needs the exact intrinsic
                  box the overlay coordinates are computed against. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.src}
                alt="Ảnh gốc"
                draggable={false}
                className="pointer-events-none absolute select-none"
                style={{
                  left: offX,
                  top: offY,
                  width: dispW,
                  height: dispH,
                  maxWidth: "none",
                }}
              />
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                <defs>
                  <mask id="scan-dim">
                    <rect x={offX} y={offY} width={dispW} height={dispH} fill="white" />
                    <polygon points={polygonPoints} fill="black" />
                  </mask>
                </defs>
                <rect
                  x={offX}
                  y={offY}
                  width={dispW}
                  height={dispH}
                  fill="rgba(0,0,0,0.55)"
                  mask="url(#scan-dim)"
                />
                <polygon points={polygonPoints} fill="none" stroke="var(--primary)" strokeWidth={2} />
                {curvePaths.map((d, i) => (
                  <path
                    key={`curve-${i}`}
                    d={d}
                    fill="none"
                    stroke="rgba(255,255,255,0.95)"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                  />
                ))}
                {gridLines.lines.map((pts, i) => (
                  <polyline
                    key={i}
                    points={pts}
                    fill="none"
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth={1}
                  />
                ))}
              </svg>

              {boundary.map((p, i) => {
                const pos = toDisplay(p);
                return (
                  <div
                    key={i}
                    onPointerDown={(e) => startDrag(i, e)}
                    onPointerMove={(e) => moveDrag(i, e)}
                    onPointerUp={() => setDragging(null)}
                    onPointerCancel={() => setDragging(null)}
                    className={cn(
                      "absolute h-6 w-6 cursor-grab touch-none rounded-lg border-2 border-white bg-primary shadow active:cursor-grabbing",
                      selected === i && "ring-2 ring-white",
                    )}
                    style={{
                      left: pos.x,
                      top: pos.y,
                      transform: "translate(-50%, -50%)",
                    }}
                  />
                );
              })}

              {boundary.map((_, i) => {
                const a = boundary[i];
                const c = boundary[(i + 1) % boundary.length];
                const mid = toDisplay({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
                return (
                  <button
                    key={`add-${i}`}
                    type="button"
                    aria-label="Thêm điểm"
                    onClick={() => addMidpoint(i)}
                    className="absolute flex h-5 w-5 items-center justify-center rounded-full border border-white/70 bg-primary/80 text-white opacity-70 transition-opacity hover:opacity-100"
                    style={{
                      left: mid.x,
                      top: mid.y,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                );
              })}
            </>
          )}
          {!nat && (
            <div className="absolute inset-0 grid animate-pulse place-items-center text-sm text-muted-foreground">
              Đang tải ảnh…
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-1 px-1 py-1">
            <Button
              variant="ghost"
              size="sm"
              className="px-2.5"
              onClick={autoDetectBoundary}
              disabled={detectBusy}
            >
              {detectBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanSearch className="h-4 w-4" />
              )}
              Dò mép
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="px-2.5"
              onClick={autoDetectBoundaryCv}
              disabled={cvBusy}
              title="Dò mép bằng OpenCV — chính xác hơn với ảnh thiếu sáng"
            >
              {cvBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanSearch className="h-4 w-4" />
              )}
              Dò mép CV
            </Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <IconButton
              aria-label="Xoay trang 90 độ"
              className="h-8 w-8"
              onClick={rotate90}
            >
              <RotateCw className="h-4 w-4" />
            </IconButton>
            <Button variant="ghost" size="sm" className="px-2.5" onClick={autoRotate}>
              <AlignVerticalJustifyCenter className="h-4 w-4" />
              Đứng thẳng
            </Button>
            <IconButton
              aria-label="Đặt lại vùng cắt"
              className="ml-auto h-8 w-8"
              onClick={() => {
                setBoundary([
                  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
                ]);
                // The reset drops any extra points, so an index past the new end
                // would stay selected and leave "Xóa điểm" enabled with nothing to
                // delete.
                setSelected(null);
              }}
            >
              <RotateCcw className="h-4 w-4" />
            </IconButton>
            <IconButton
              aria-label="Xóa điểm đang chọn"
              tone="danger"
              className="h-8 w-8"
              onClick={removeSelected}
              disabled={selected === null || boundary.length <= 4}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
          <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            {cvError ? (
              <span className="text-destructive">{cvError}</span>
            ) : (
              "Chạm dấu + để thêm điểm giữa hai góc · kéo điểm để bám mép giấy."
            )}
          </p>
        </div>

        {/* Paper preview — the page as it will print, on the bed. It needs a
            definite height: given only `h-auto` inside a column, the sheet
            stretches to the row and loses its paper shape. */}
        <section className="rounded-xl border border-border bg-card p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Xem trước tờ giấy
          </h3>
          <div className="bed h-56 w-full rounded-lg p-3 sm:h-64">
            <PagePreview page={draft} maxDim={640} debounceMs={120} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Sau khi nắn thẳng và kéo dãn theo khổ giấy đã chọn.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Kích thước giấy
          </h3>
          <Segmented
            label="Kích thước giấy"
            value={paper.kind}
            options={PAPER_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.label,
            }))}
            onChange={(kind) => setPaper(paperFor(kind, paper))}
          />
          {paper.kind === "custom" && (
            <div className="mt-2 flex items-center gap-2">
              <label className="sr-only" htmlFor="paper-w">
                Chiều rộng (mm)
              </label>
              <input
                id="paper-w"
                type="number"
                min={40}
                max={600}
                value={paper.widthMm}
                onChange={(e) => setCustomPaper(Number(e.target.value), paper.heightMm)}
                className="h-9 w-24 rounded-lg border border-border bg-muted px-2 font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">×</span>
              <label className="sr-only" htmlFor="paper-h">
                Chiều cao (mm)
              </label>
              <input
                id="paper-h"
                type="number"
                min={40}
                max={1000}
                value={paper.heightMm}
                onChange={(e) => setCustomPaper(paper.widthMm, Number(e.target.value))}
                className="h-9 w-24 rounded-lg border border-border bg-muted px-2 font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">mm</span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => onApplyToAll(paper)}
          >
            Áp dụng cho tất cả trang
          </Button>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Màu sắc
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="px-2"
              onClick={autoColor}
              disabled={autoBusy}
            >
              {autoBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Cân bằng tự động
            </Button>
          </div>
          <Segmented
            label="Kiểu màu"
            value={filter}
            options={FILTERS}
            onChange={applyPreset}
          />

          <div className="mt-3 flex flex-col gap-2">
            <Switch
              label="Khử bóng và nền trắng"
              hint="Làm phẳng ánh sáng lệch, giữ nền giấy trắng đều."
              checked={shadow}
              onChange={setShadow}
            />
            <Switch
              label="Tăng độ sắc nét"
              hint="Làm rõ nét chữ nhỏ và mảnh."
              checked={sharpen}
              onChange={setSharpen}
            />
            {sharpen && (
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                <Range
                  label="Độ sắc nét"
                  value={sharpenStrength}
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  onChange={setSharpenStrength}
                  format={(v) => `${Math.round(v * 100)}%`}
                  lowLabel="Dịu"
                  highLabel="Gắt"
                  hint="Quá cao sẽ nổi hạt nhiễu trên nền giấy."
                />
              </div>
            )}
            <Switch
              label="Uốn thẳng mép cong"
              hint={
                boundary.length > 4
                  ? "Đang uốn theo các điểm bạn thêm trên viền."
                  : hasCurves
                    ? "Bù độ cong đo được của mép giấy."
                    : undefined
              }
              checked={hasCurves && curvesEnabled}
              onChange={setCurvesEnabled}
              disabled={!hasCurves}
              disabledHint="Chưa đo được mép cong — bấm “Dò mép”."
            />
            <Switch
              label="Làm phẳng trang cong"
              hint="Thử nghiệm: điều chỉnh theo độ cong của trang khi chụp."
              checked={dewarpStrength !== 0}
              onChange={(on) => setDewarpStrength(on ? 0.5 : 0)}
            />
            {dewarpStrength !== 0 && (
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                <Range
                  label="Độ cong"
                  value={dewarpStrength}
                  min={-1}
                  max={1}
                  step={0.05}
                  onChange={setDewarpStrength}
                  format={(v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`}
                  lowLabel="Lõm"
                  highLabel="Phồng"
                />
              </div>
            )}
          </div>

          {boundary.length <= 4 && hasCurves && (
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Độ cong đo được — trên {fmtPct(curves[0])} · phải {fmtPct(curves[1])} ·
              dưới {fmtPct(curves[2])} · trái {fmtPct(curves[3])}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2.5 rounded-xl border border-border bg-muted/40 px-3 py-3">
            {(
              [
                ["brightness", "Độ sáng"],
                ["contrast", "Tương phản"],
                ["saturation", "Bão hòa"],
              ] as [keyof Adjust, string][]
            ).map(([key, label]) => (
              <Range
                key={key}
                label={label}
                value={adjust[key]}
                min={0}
                max={2}
                step={0.01}
                onChange={(v) => adjustField(key, v)}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            ))}
          </div>
        </section>
      </div>
    </Sheet>
  );
}
