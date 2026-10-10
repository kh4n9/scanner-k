"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Loader2, Plus, RotateCcw, RotateCw, ScanSearch, Trash2, Wand2 } from "lucide-react";
import {
  clamp,
  computeAutoAdjust,
  detectDocBoundary,
  loadImage,
} from "@/lib/image";
import { detectWithOpenCv } from "@/lib/opencv";
import { PAPER_OPTIONS, paperFor } from "@/lib/paper";
import type { Adjust, FilterMode, PaperShape, Point, Rotate, ScanPage } from "@/lib/types";
import { NEUTRAL_ADJUST } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PagePreview } from "./PagePreview";

const FILTERS: { value: FilterMode; label: string }[] = [
  { value: "original", label: "Gốc" },
  { value: "color", label: "Màu" },
  { value: "grayscale", label: "Xám" },
  { value: "bw", label: "Đen trắng" },
];

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
  const [rotation, setRotation] = React.useState<Rotate>(page.rotation ?? 0);
  const [dewarpStrength, setDewarpStrength] = React.useState(page.dewarpStrength ?? 0);
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
    if (!nat || !box || boundary.length < 4) return [];
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
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary, nat, box, dispW, dispH, offX, offY]);

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
      setBoundary(next);
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
      if (next.length === 4) setBoundary(next);
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
    setRotation(Math.abs(bw - bh) > 0.02 && bw > bh ? 90 : 0);
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
      rotation,
      dewarpStrength,
    }),
    [page, boundary, paper, filter, adjust, shadow, sharpen, rotation, dewarpStrength],
  );

  const setCustomPaper = (w: number, h: number) => {
    setPaper({ kind: "custom", widthMm: Math.round(w), heightMm: Math.round(h) });
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
      title="Chỉnh vùng phiếu"
      footer={
        <Button
          size="lg"
          className="w-full"
          onClick={() => onApply({ boundary, paper, filter, adjust, shadow, sharpen, rotation, dewarpStrength })}
        >
          Áp dụng
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <div
          ref={containerRef}
          className="relative h-[46dvh] w-full touch-none overflow-hidden rounded-xl bg-black"
        >
          {nat && box && boundary.length >= 4 && (
            <>
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
                {gridLines.map((pts, i) => (
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

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={autoDetectBoundary} disabled={detectBusy}>
            {detectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            Tự dò lại
          </Button>
          <Button variant="secondary" size="sm" onClick={autoDetectBoundaryCv} disabled={cvBusy}>
            {cvBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            Tự dò (CV)
          </Button>
          {cvError && (
            <span className="text-xs text-destructive">{cvError}</span>
          )}
          <IconButton aria-label="Đặt lại" className="h-8 w-8" onClick={() => setBoundary([
            { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
          ])}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
          <Button
            variant="secondary"
            size="sm"
            onClick={removeSelected}
            disabled={selected === null || boundary.length <= 4}
          >
            <Trash2 className="h-4 w-4" />
            Xóa điểm
          </Button>
          <IconButton aria-label="Xoay 90°" className="h-8 w-8" onClick={rotate90}>
            <RotateCw className="h-4 w-4" />
          </IconButton>
          <Button variant="secondary" size="sm" onClick={autoRotate}>
            Đứng thẳng
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            Chạm + để thêm điểm · kéo điểm để bám mép giấy
          </span>
        </div>

        {/* Paper preview. The sheet keeps its real ratio for the paper that is
            selected, so switching A4 / Letter / custom visibly reshapes it. */}
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Xem trước tờ giấy
          </p>
          <div className="h-[34dvh] w-full">
            <PagePreview page={draft} maxDim={640} debounceMs={120} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Sau khi nắn thẳng và kéo dãn theo khổ giấy đã chọn.
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Kích thước giấy
          </p>
          <div className="grid grid-cols-4 gap-2">
            {PAPER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPaper(paperFor(opt.value, paper))}
                className={cn(
                  "rounded-full border border-border px-2 py-2 text-xs font-medium transition-colors",
                  paper.kind === opt.value
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "hover:bg-accent/60",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {paper.kind === "custom" && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={40}
                max={600}
                value={paper.widthMm}
                onChange={(e) => setCustomPaper(Number(e.target.value), paper.heightMm)}
                className="w-24 rounded-lg border border-border bg-transparent px-2 py-2 text-sm"
                aria-label="Chiều rộng mm"
              />
              <span className="text-xs text-muted-foreground">×</span>
              <input
                type="number"
                min={40}
                max={1000}
                value={paper.heightMm}
                onChange={(e) => setCustomPaper(paper.widthMm, Number(e.target.value))}
                className="w-24 rounded-lg border border-border bg-transparent px-2 py-2 text-sm"
                aria-label="Chiều cao mm"
              />
              <span className="text-xs text-muted-foreground">mm</span>
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => onApplyToAll(paper)}
          >
            Áp dụng cho tất cả trang
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            A4 và Letter cho mọi trang cùng khổ. Tự động thì mỗi trang theo tỉ lệ riêng.
          </p>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Màu sắc
            <Button variant="secondary" size="sm" className="ml-auto" onClick={autoColor} disabled={autoBusy}>
              {autoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Tự động
            </Button>
          </p>
          <div className="grid grid-cols-4 gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => applyPreset(f.value)}
                className={cn(
                  "rounded-full border border-border px-3 py-2 text-xs font-medium transition-colors",
                  filter === f.value
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "hover:bg-accent/60",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShadow((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors",
                shadow ? "bg-primary text-primary-foreground border-transparent" : "hover:bg-accent/60",
              )}
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded border border-current text-[9px]",
                  shadow && "bg-transparent",
                )}
              >
                {shadow ? "✓" : ""}
              </span>
              Khử bóng / nền trắng
            </button>
            <button
              type="button"
              onClick={() => setSharpen((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors",
                sharpen ? "bg-primary text-primary-foreground border-transparent" : "hover:bg-accent/60",
              )}
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded border border-current text-[9px]",
                  sharpen && "bg-transparent",
                )}
              >
                {sharpen ? "✓" : ""}
              </span>
              Tăng độ sắc nét
            </button>
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setDewarpStrength((v) => (v === 0 ? 0.5 : 0))}
              className={cn(
                "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors",
                dewarpStrength !== 0
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "hover:bg-accent/60",
              )}
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded border border-current text-[9px]",
                  dewarpStrength !== 0 && "bg-transparent",
                )}
              >
                {dewarpStrength !== 0 ? "✓" : ""}
              </span>
              Làm phẳng trang cong
            </button>
            {dewarpStrength !== 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">Lõm</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    value={dewarpStrength}
                    onChange={(e) => setDewarpStrength(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="text-[11px] text-muted-foreground">Phồng</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Thử nghiệm: điều chỉnh theo độ cong trang khi chụp.
                </p>
              </div>
            )}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(
              [
                ["brightness", "Độ sáng"],
                ["contrast", "Tương phản"],
                ["saturation", "Bão hòa"],
              ] as [keyof Adjust, string][]
            ).map(([key, label]) => (
              <div key={key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{label}</span>
                  <span className="tabular-nums text-muted-foreground">{Math.round(adjust[key] * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.01}
                  value={adjust[key]}
                  onChange={(e) => adjustField(key, Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            ))}
          </div>
        </div>

      </div>
    </Sheet>
  );
}
