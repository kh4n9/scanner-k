"use client";

import * as React from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Range } from "@/components/ui/range";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  FileDown,
  Loader2,
  Save,
  ScanText,
  Share2,
} from "lucide-react";
import { buildExport, downloadBlob, saveBlobToDisk, shareBlob } from "@/lib/export";
import type { ExportFormat, ExportResult } from "@/lib/export";
import { warpPoly } from "@/lib/image";
import { ocrImage } from "@/lib/ocr";
import { activeCurves, activeSharpen } from "@/lib/types";
import type { ScanPage } from "@/lib/types";
import { formatBytes } from "@/lib/utils";

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPG" },
];

const DPI = [
  { value: "150", label: "150", hint: "nhẹ" },
  { value: "200", label: "200", hint: "vừa" },
  { value: "300", label: "300", hint: "in" },
];

/**
 * Turn the pages into a file.
 *
 * The order here is the order the user thinks in: what format, how sharp, then
 * the two things you can do with the result (share it, or keep it). OCR is a
 * different kind of job — it reads the document rather than printing it — so it
 * sits below a divider instead of competing with the file controls.
 */
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
  const [dpi, setDpi] = React.useState("200");
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
      const res = await buildExport(pages, format, {
        dpi: Number(dpi),
        quality,
      });
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
      setError(
        "Chia sẻ không khả dụng trên trình duyệt này — hãy dùng nút Tạo để tải file.",
      );
    }
  };

  const save = async () => {
    if (!result) return;
    setError(null);
    const ok = await saveBlobToDisk(result.blob, result.filename);
    if (!ok) {
      setError(
        "Lưu vào thiết bị không khả dụng (cần Chrome/Edge) — file đã được tải xuống.",
      );
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
            sharpen: activeSharpen(page),
            rotation: page.rotation ?? 0,
            dewarpStrength: page.dewarpStrength ?? 0,
            curves: activeCurves(page),
            maxDim: 1600,
          });
          const url = canvas.toDataURL("image/png");
          const text = await ocrImage(url);
          all +=
            (all ? "\n\n" : "") +
            `— Trang ${i + 1} —\n` +
            (text.trim() || "(không nhận diện được chữ)");
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
      description="Mỗi trang được nắn thẳng và kéo dãn đúng khổ giấy đã chọn."
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
              <>
                <FileDown className="h-4 w-4" aria-hidden="true" />
                Tạo {formatLabel} · {pages.length} trang
              </>
            )}
          </Button>
          {result && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={share} disabled={busy}>
                <Share2 className="h-4 w-4" /> Chia sẻ
              </Button>
              <Button variant="outline" onClick={save} disabled={busy}>
                <Save className="h-4 w-4" /> Lưu vào máy
              </Button>
            </div>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Định dạng
          </h3>
          <Segmented
            label="Định dạng tệp"
            value={format}
            options={FORMATS}
            onChange={setFormat}
          />
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {format === "pdf"
              ? "PDF: một tệp nhiều trang, không viền, in ra đúng khổ giấy."
              : format === "png"
                ? "PNG: từng trang một tệp, nén không mất chi tiết — nặng hơn."
                : "JPG: từng trang một tệp, dung lượng nhỏ hơn PNG."}
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Độ phân giải
          </h3>
          <Segmented label="Độ phân giải" value={dpi} options={DPI} onChange={setDpi} />
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Cao hơn cho chữ sắc nét khi in hoặc phóng to, nhưng tệp nặng hơn.
          </p>
        </div>

        {format !== "png" && (
          <div>
            <Range
              label="Chất lượng ảnh"
              value={quality}
              min={0.5}
              max={1}
              step={0.05}
              onChange={setQuality}
              format={(v) => `${Math.round(v * 100)}%`}
              lowLabel="Nhẹ hơn"
              highLabel="Sắc nét hơn"
            />
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        {result && (
          <p className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
            <CircleCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span>
              Đã tạo {formatLabel} ·{" "}
              <span className="font-mono tabular-nums">
                {formatBytes(result.blob.size)}
              </span>
            </span>
          </p>
        )}

        <div className="border-t border-border pt-5">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Đọc chữ trong ảnh
          </h3>
          <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
            Trích văn bản từ các trang thành chữ có thể sao chép được.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={runOcr}
            disabled={ocrBusy || pages.length === 0}
          >
            {ocrBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ScanText className="h-4 w-4" />
            )}
            {ocrBusy ? "Đang trích xuất…" : "Trích xuất văn bản"}
          </Button>
          {ocrError && (
            <p className="mt-2 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <CircleAlert
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
              {ocrError}
            </p>
          )}
          {ocrText && (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">Văn bản đã trích xuất</h4>
                <Button variant="ghost" size="sm" onClick={copyOcr} className="px-2">
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "Đã chép" : "Sao chép"}
                </Button>
              </div>
              <textarea
                value={ocrText}
                readOnly
                rows={8}
                aria-label="Văn bản đã trích xuất"
                className="w-full resize-y rounded-xl border border-border bg-muted px-3 py-2 text-sm leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
