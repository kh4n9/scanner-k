"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Share2, Save, Loader2, ScanText, Copy, Check } from "lucide-react";
import { buildExport, downloadBlob, saveBlobToDisk, shareBlob } from "@/lib/export";
import type { ExportFormat, ExportResult } from "@/lib/export";
import { warpPoly } from "@/lib/image";
import { ocrImage } from "@/lib/ocr";
import { cn, formatBytes } from "@/lib/utils";
import { activeCurves } from "@/lib/types";
import type { ScanPage } from "@/lib/types";

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPG" },
];

export function ExportSheet({
  open,
  onClose,
  pages,
}: {
  open: boolean;
  onClose: () => void;
  pages: ScanPage[];
}) {
  const [format, setFormat] = React.useState<ExportFormat>("pdf");
  // 0.9 instead of 0.8: at the exported DPI the difference is mostly JPEG
  // ringing around small text, which is exactly the detail a scan should keep.
  const [quality, setQuality] = React.useState(0.9);
  const [dpi, setDpi] = React.useState(200);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ExportResult | null>(null);
  const [ocrBusy, setOcrBusy] = React.useState(false);
  const [ocrText, setOcrText] = React.useState("");
  const [ocrError, setOcrError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await buildExport(pages, format, { dpi, quality });
      downloadBlob(res.blob, res.filename);
      setResult(res);
    } catch {
      setError("Không thể tạo file. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!result) return;
    setError(null);
    const ok = await shareBlob(result.blob, result.filename);
    if (!ok) {
      setError("Chia sẻ không khả dụng trên trình duyệt này — hãy dùng nút Tạo để tải file.");
    }
  };

  const save = async () => {
    if (!result) return;
    setError(null);
    const ok = await saveBlobToDisk(result.blob, result.filename);
    if (!ok) {
      setError("Lưu vào thiết bị không khả dụng (cần Chrome/Edge) — file đã được tải xuống.");
      downloadBlob(result.blob, result.filename);
    }
  };

  const runOcr = async () => {
    setOcrBusy(true);
    setOcrError(null);
    setOcrText("");
    setCopied(false);
    try {
      let all = "";
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        try {
          const { canvas } = await warpPoly({
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
            maxDim: 1600,
          });
          const url = canvas.toDataURL("image/png");
          const text = await ocrImage(url);
          all += (all ? "\n\n" : "") + `— Trang ${i + 1} —\n` + (text.trim() || "(không nhận diện được chữ)");
        } catch {
          all += (all ? "\n\n" : "") + `— Trang ${i + 1} —\n(OCR lỗi)`;
        }
      }
      setOcrText(all.trim());
      if (!all.trim()) setOcrError("OCR không nhận diện được chữ.");
    } catch {
      setOcrError("OCR không khả dụng (cần mạng để tải Tesseract.js).");
    } finally {
      setOcrBusy(false);
    }
  };

  const copyOcr = async () => {
    if (!ocrText) return;
    try {
      await navigator.clipboard.writeText(ocrText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const formatLabel = FORMATS.find((f) => f.value === format)?.label ?? "PDF";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Xuất tài liệu"
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="w-full"
            onClick={generate}
            disabled={busy || pages.length === 0}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Đang tạo…
              </>
            ) : (
              `Tạo ${formatLabel} (${pages.length} trang)`
            )}
          </Button>
          {result && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" onClick={share} disabled={busy}>
                <Share2 className="h-4 w-4" /> Chia sẻ
              </Button>
              <Button variant="secondary" size="sm" onClick={save} disabled={busy}>
                <Save className="h-4 w-4" /> Lưu vào thiết bị
              </Button>
            </div>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <p className="text-sm text-muted-foreground">
          Mỗi trang được nắn thẳng, kéo dãn đúng khổ giấy đã chọn và phủ kín trang
          — PDF xuất không viền, ảnh/PNG giữ nguyên khổ.
        </p>

        <div>
          <p className="mb-2 text-sm font-medium">Định dạng</p>
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFormat(f.value)}
                className={cn(
                  "rounded-full border border-border px-3 py-2 text-xs font-medium transition-colors",
                  format === f.value
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "hover:bg-accent/60",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Độ phân giải (DPI)</p>
          <div className="grid grid-cols-3 gap-2">
            {[150, 200, 300].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setDpi(v)}
                className={cn(
                  "rounded-full border border-border px-3 py-2 text-xs font-medium transition-colors",
                  dpi === v
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "hover:bg-accent/60",
                )}
              >
                {v} DPI
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Cao hơn = sắc nét hơn khi in/phóng; file to hơn.
          </p>
        </div>

        {format !== "png" && (
          <div>
            <p className="mb-2 text-sm font-medium">Chất lượng ảnh</p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(quality * 100)}%
              </span>
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Nhẹ hơn</span>
              <span>Sắc nét hơn</span>
            </div>
          </div>
        )}

        <div className="border-t border-border pt-5">
          <Button variant="secondary" className="w-full" onClick={runOcr} disabled={ocrBusy || pages.length === 0}>
            {ocrBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
            {ocrBusy ? "Đang trích xuất…" : "Trích xuất văn bản (OCR)"}
          </Button>
          {ocrError && (
            <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {ocrError}
            </p>
          )}
          {ocrText && (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Văn bản đã trích xuất</p>
                <Button variant="secondary" size="sm" onClick={copyOcr}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Đã chép" : "Sao chép"}
                </Button>
              </div>
              <textarea
                value={ocrText}
                readOnly
                rows={8}
                className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {result && (
          <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm">
            Đã tạo {formatLabel} (~{formatBytes(result.blob.size)}). Dùng nút Chia
            sẻ hoặc Lưu vào thiết bị nếu cần.
          </p>
        )}
      </div>
    </Sheet>
  );
}
