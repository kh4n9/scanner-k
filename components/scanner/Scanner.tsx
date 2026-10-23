"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Eye,
  FileDown,
  FilePlus,
  FilePlus2,
  Loader2,
  Pencil,
  ScanSearch,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AddSourcePad } from "./AddSourcePad";
import { PagesGrid } from "./PagesGrid";
import { PaperBulkControl } from "./PaperBulkControl";
import { computeAutoAdjust, detectDocBoundary, evictImage, fileToSrc } from "@/lib/image";
import { uid } from "@/lib/utils";
import { NEUTRAL_ADJUST } from "@/lib/types";
import {
  deleteDocument,
  listDocuments,
  loadDocument,
  saveDocument,
} from "@/lib/db";
import type { DocMeta, StoredDoc, StoredPage } from "@/lib/db";
import type { Adjust, EdgeCurves, PaperShape, Point, ScanPage } from "@/lib/types";

// Heavy, on-demand surfaces. Keeping them out of the /scan entry chunk means a
// first-time visitor does not download pdf-lib (export), Tesseract's wrapper
// (OCR) or the full editor before adding a single page.
const PageEditor = dynamic(
  () => import("./PageEditor").then((m) => m.PageEditor),
  { ssr: false },
);
const ExportSheet = dynamic(
  () => import("./ExportSheet").then((m) => m.ExportSheet),
  { ssr: false },
);
const PreviewSheet = dynamic(
  () => import("./PreviewSheet").then((m) => m.PreviewSheet),
  { ssr: false },
);
const CameraCapture = dynamic(
  () => import("./CameraCapture").then((m) => m.CameraCapture),
  { ssr: false },
);

/** Turn an in-memory page into a persisted record, reusing the cached image
 *  bytes when possible and otherwise fetching from the object URL. */
async function toStored(p: ScanPage): Promise<StoredPage> {
  let image = p.image;
  let mime = p.mime ?? "image/jpeg";
  if (!image) {
    try {
      const blob = await fetch(p.src).then((r) => r.blob());
      image = await blob.arrayBuffer();
      if (blob.type) mime = blob.type;
    } catch {
      image = new ArrayBuffer(0);
    }
  }
  return {
    id: p.id,
    name: p.name,
    boundary: p.boundary,
    paper: p.paper,
    filter: p.filter,
    adjust: p.adjust,
    shadow: p.shadow,
    sharpen: p.sharpen,
    sharpenStrength: p.sharpenStrength,
    rotation: p.rotation ?? 0,
    dewarpStrength: p.dewarpStrength ?? 0,
    curves: p.curves,
    curvesEnabled: p.curvesEnabled,
    image,
    mime,
  };
}

function revokePages(ps: ScanPage[]) {
  for (const p of ps) {
    URL.revokeObjectURL(p.src);
    evictImage(p.src);
  }
}

function restorePages(stored: StoredPage[]): ScanPage[] {
  return stored.map((p) => ({
    id: p.id,
    src: URL.createObjectURL(new Blob([p.image], { type: p.mime })),
    name: p.name,
    boundary: p.boundary,
    paper: p.paper,
    filter: p.filter,
    adjust: p.adjust,
    shadow: p.shadow,
    sharpen: p.sharpen,
    sharpenStrength: p.sharpenStrength,
    rotation: p.rotation,
    dewarpStrength: p.dewarpStrength,
    curves: p.curves,
    curvesEnabled: p.curvesEnabled,
    image: p.image,
    mime: p.mime,
  }));
}

export function Scanner() {
  const [pages, setPages] = React.useState<ScanPage[]>([]);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [showCapture, setShowCapture] = React.useState(false);
  const [showExport, setShowExport] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [redetecting, setRedetecting] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  const [confirmDeleteDoc, setConfirmDeleteDoc] = React.useState(false);

  // One pending page deletion at a time, with a few seconds to undo it. The
  // object URL is only revoked once that window closes, otherwise "Hoàn tác"
  // would bring back a page pointing at a dead blob.
  const [undo, setUndo] = React.useState<{ page: ScanPage; index: number } | null>(
    null,
  );
  const undoRef = React.useRef<{ page: ScanPage; index: number } | null>(null);
  const undoTimer = React.useRef<number | null>(null);

  // Persistence / multi-document state.
  const [docId, setDocId] = React.useState<string | null>(null);
  const [docName, setDocName] = React.useState("Tài liệu mới");
  const [docs, setDocs] = React.useState<DocMeta[]>([]);
  const [restoring, setRestoring] = React.useState(true);
  const docIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    docIdRef.current = docId;
  }, [docId]);

  const editing = pages.find((p) => p.id === editingId) ?? null;

  // Keep the latest pages in a ref so the unmount cleanup can revoke every
  // blob URL (page.src) we created — otherwise memory leaks if the user adds
  // or deletes many pages in one session.
  const pagesRef = React.useRef(pages);
  React.useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // Revoke every object URL on unmount. Without this a long session that adds
  // and removes pages keeps the blobs alive until the tab is closed.
  React.useEffect(
    () => () => {
      revokePages(pagesRef.current);
    },
    [],
  );

  const addFile = React.useCallback(async (file: File) => {
    const src = await fileToSrc(file);
    // Keep the downscaled bytes so the page can be persisted across reloads.
    let image: ArrayBuffer | undefined;
    let mime = "image/jpeg";
    try {
      const blob = await fetch(src).then((r) => r.blob());
      image = await blob.arrayBuffer();
      if (blob.type) mime = blob.type;
    } catch {
      // Non-fatal: the page still works in memory this session.
    }
    let boundary: Point[];
    let curves: EdgeCurves = [0, 0, 0, 0];
    try {
      const detected = await detectDocBoundary(src);
      boundary = detected.boundary;
      curves = detected.curves;
    } catch {
      boundary = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
    }
    let adjust: Adjust = { ...NEUTRAL_ADJUST };
    // On by default: background flattening is a near no-op on an already-white,
    // evenly lit page, and it is what keeps the paper white under a colour cast.
    let shadow = true;
    try {
      const res = await computeAutoAdjust(src);
      adjust = res.adjust;
      shadow = res.shadow;
    } catch {
      // keep neutral
    }
    setPages((prev) => [
      ...prev,
      {
        id: uid(),
        src,
        name: file.name.replace(/\.[^.]+$/, ""),
        boundary,
        paper: { kind: "auto" },
        filter: "original",
        adjust,
        shadow,
        sharpen: true,
        rotation: 0,
        curves,
        curvesEnabled: true,
        image,
        mime,
      },
    ]);
  }, []);

  const addFiles = React.useCallback(
    async (files: File[]) => {
      setAdding(true);
      try {
        for (const file of files) {
          await addFile(file);
        }
      } finally {
        setAdding(false);
      }
    },
    [addFile],
  );

  const updatePage = React.useCallback((id: string, patch: Partial<ScanPage>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  /** Re-run detection on every page. This is what lets pages added before the
   *  edge-curvature measurement existed pick up their measured bows without
   *  being removed and re-added. Runs one page at a time: detection loads and
   *  thresholds each image, and a document can be long. */
  const redetectAll = React.useCallback(async () => {
    setRedetecting(true);
    try {
      for (const page of pagesRef.current) {
        try {
          const detected = await detectDocBoundary(page.src);
          updatePage(page.id, { boundary: detected.boundary, curves: detected.curves });
        } catch {
          // Leave this page's current boundary alone.
        }
      }
    } finally {
      setRedetecting(false);
    }
  }, [updatePage]);

  /** Set one paper size across the whole document. */
  const applyPaperToAll = React.useCallback((paper: PaperShape) => {
    setPages((prev) => prev.map((p) => ({ ...p, paper })));
  }, []);

  /** Commit a pending deletion for good: revoke the page's blob URL. */
  const finalizeUndo = React.useCallback(() => {
    const current = undoRef.current;
    if (undoTimer.current !== null) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    if (current) {
      URL.revokeObjectURL(current.page.src);
      evictImage(current.page.src);
    }
    undoRef.current = null;
    setUndo(null);
  }, []);

  const deletePage = React.useCallback(
    (id: string) => {
      const current = pagesRef.current;
      const index = current.findIndex((p) => p.id === id);
      if (index < 0) return;
      // Deleting twice in a row commits the earlier one.
      finalizeUndo();
      const page = current[index];
      setPages(current.filter((p) => p.id !== id));
      const pending = { page, index };
      undoRef.current = pending;
      setUndo(pending);
      undoTimer.current = window.setTimeout(finalizeUndo, 6000);
    },
    [finalizeUndo],
  );

  const undoDelete = React.useCallback(() => {
    const current = undoRef.current;
    if (!current) return;
    if (undoTimer.current !== null) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    undoRef.current = null;
    setUndo(null);
    setPages((prev) => {
      const next = [...prev];
      next.splice(Math.min(current.index, next.length), 0, current.page);
      return next;
    });
  }, []);

  // Release the blob URL of a page still pending deletion when leaving the page.
  React.useEffect(
    () => () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  const movePage = React.useCallback((id: string, dir: -1 | 1) => {
    setPages((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }, []);

  // Restore the most recent document on first load.
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const metas = await listDocuments();
        if (mounted) setDocs(metas);
        if (metas.length > 0) {
          const doc = await loadDocument(metas[0].id);
          if (mounted && doc) {
            setPages(restorePages(doc.pages));
            setDocId(doc.id);
            docIdRef.current = doc.id;
            setDocName(doc.name);
          }
        }
      } catch {
        // Ignore: fall back to an empty in-memory document.
      } finally {
        if (mounted) setRestoring(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Debounced autosave of the current document to IndexedDB.
  React.useEffect(() => {
    if (restoring) return;
    if (docIdRef.current === null && pages.length === 0) return;
    const timer = setTimeout(async () => {
      try {
        let id = docIdRef.current;
        if (id === null) {
          id = uid();
          docIdRef.current = id;
          setDocId(id);
        }
        const stored = await Promise.all(pages.map(toStored));
        const doc: StoredDoc = {
          id,
          name: docName,
          updatedAt: Date.now(),
          pages: stored,
        };
        await saveDocument(doc);
        setDocs(await listDocuments());
      } catch {
        // Ignore storage errors.
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [pages, docName, restoring]);

  // Immediately persist the current pages, bypassing the debounce — used before
  // switching or creating a document so pending edits are never lost.
  const flushSave = async () => {
    if (restoring) return;
    let id = docIdRef.current;
    if (id === null && pages.length === 0) return;
    try {
      if (id === null) {
        id = uid();
        docIdRef.current = id;
        setDocId(id);
      }
      const stored = await Promise.all(pages.map(toStored));
      await saveDocument({ id, name: docName, updatedAt: Date.now(), pages: stored });
      setDocs(await listDocuments());
    } catch {
      // Ignore storage errors.
    }
  };

  const switchDoc = async (id: string) => {
    if (id === docId) return;
    await flushSave();
    const doc = await loadDocument(id).catch(() => null);
    if (!doc) return;
    revokePages(pages);
    setPages(restorePages(doc.pages));
    setDocId(id);
    docIdRef.current = id;
    setDocName(doc.name);
  };

  const newDoc = async () => {
    await flushSave();
    revokePages(pages);
    setPages([]);
    setDocId(null);
    docIdRef.current = null;
    setDocName("Tài liệu mới");
  };

  const startRename = () => {
    setDraftName(docName);
    setRenaming(true);
  };

  const commitRename = () => {
    const name = draftName.trim();
    if (name) setDocName(name);
    setRenaming(false);
  };

  const deleteCurrentDoc = async () => {
    if (!docId) return;
    await deleteDocument(docId).catch(() => {});
    revokePages(pages);
    setPages([]);
    setDocId(null);
    docIdRef.current = null;
    setDocName("Tài liệu mới");
    setDocs(await listDocuments().catch(() => []));
  };

  const showDocBar = !restoring && (docs.length > 0 || docId !== null);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-4 sm:max-w-4xl sm:px-6 sm:pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pt-6">
      <header className="mb-5 flex items-center gap-2">
        <Link
          href="/"
          aria-label="Về trang chủ"
          className="-ml-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={draftName}
              maxLength={80}
              aria-label="Tên tài liệu"
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenaming(false);
                }
              }}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
            />
          ) : (
            <h1 className="truncate text-lg font-semibold leading-tight tracking-tight sm:text-xl">
              {docName}
            </h1>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {pages.length === 0 ? (
              "Chưa có trang nào"
            ) : (
              <>
                <span className="font-mono tabular-nums">{pages.length}</span>
                <span>trang sẽ được gộp thành PDF</span>
              </>
            )}
          </p>
        </div>
        {!renaming && (
          <IconButton aria-label="Đổi tên tài liệu" onClick={startRename}>
            <Pencil className="h-4 w-4" />
          </IconButton>
        )}
      </header>

      {showDocBar && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
          <label className="sr-only" htmlFor="doc-select">
            Chọn tài liệu
          </label>
          <select
            id="doc-select"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-muted px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={docId ?? ""}
            onChange={(e) => switchDoc(e.target.value)}
          >
            {docId === null && <option value="">Tài liệu mới</option>}
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.count})
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={newDoc}>
              <FilePlus className="h-3.5 w-3.5" aria-hidden="true" />
              Tài liệu mới
            </Button>
            <IconButton
              aria-label="Xóa tài liệu này"
              tone="danger"
              className="h-8 w-8"
              onClick={() => setConfirmDeleteDoc(true)}
              disabled={!docId}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      )}

      {!restoring && pages.length > 0 && (
        <div className="mb-4 rounded-xl border border-border bg-card p-3">
          <PaperBulkControl pages={pages} onApply={applyPaperToAll} />
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="px-2"
              onClick={redetectAll}
              disabled={redetecting}
            >
              {redetecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanSearch className="h-4 w-4" />
              )}
              Dò lại mép giấy
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Đo lại mép giấy cong cho những trang đã thêm từ trước.
            </span>
          </div>
        </div>
      )}

      {restoring ? (
        <p className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang mở tài liệu…
        </p>
      ) : pages.length === 0 ? (
        <section className="bed relative overflow-hidden rounded-2xl border border-border">
          <div className="sweep" aria-hidden="true" />
          <div className="relative z-10 flex flex-col items-center px-5 py-14 text-center sm:py-16">
            <h2 className="text-2xl font-semibold tracking-tight">
              Bắt đầu bằng một trang
            </h2>
            <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Chụp thẳng trang giấy hoặc chọn ảnh có sẵn. Ảnh được xử lý ngay
              trên thiết bị — không tải lên máy chủ.
            </p>
            <div className="mt-7 w-full max-w-sm">
              <AddSourcePad
                onFiles={addFiles}
                onCamera={() => {
                  setShowCapture(true);
                  setShowAdd(false);
                }}
              />
            </div>
            {adding && (
              <p
                role="status"
                className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{" "}
                Đang thêm ảnh…
              </p>
            )}
          </div>
        </section>
      ) : (
        <>
          <PagesGrid
            pages={pages}
            onEdit={setEditingId}
            onDelete={deletePage}
            onMove={movePage}
            onRotate={(id) => {
              const page = pages.find((p) => p.id === id);
              if (!page) return;
              updatePage(id, { rotation: (((page.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270 });
            }}
          />
          {adding && (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý ảnh…
            </p>
          )}
        </>
      )}

      {undo && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 sm:bottom-[calc(6.5rem+env(safe-area-inset-bottom))]"
        >
          <div className="pointer-events-auto fade-in flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-xl">
            <span>Đã xóa 1 trang</span>
            <button
              type="button"
              onClick={undoDelete}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Hoàn tác
            </button>
          </div>
        </div>
      )}

      {/* One bar, three actions, and it has to fit a 320px-wide phone without
          clipping: at sm and below the two secondary actions drop to their
          icons (the labels move into aria-label, nothing is lost to a screen
          reader) and the commit button keeps enough width to read. Measured at
          320/360/372/390/414 px; the bar used to need 441px inside a 348px box
          and simply had its right edge cut off. */}
      <div className="pb-safe-bar fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/85 px-3 pt-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-stretch gap-2">
          <Button
            variant="outline"
            className="px-3 sm:px-4"
            aria-label="Thêm trang"
            onClick={() => setShowAdd(true)}
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Thêm trang</span>
          </Button>
          <Button
            variant="ghost"
            className="px-3 sm:px-4"
            aria-label="Xem trước tài liệu"
            disabled={pages.length === 0}
            onClick={() => setShowPreview(true)}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Xem trước</span>
          </Button>
          <Button
            className="ml-auto min-w-0 flex-1 px-4 sm:flex-none"
            disabled={pages.length === 0}
            onClick={() => setShowExport(true)}
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            {pages.length > 0 ? (
              <>
                <span className="sm:hidden">Xuất PDF</span>
                <span className="hidden sm:inline">Xuất PDF · {pages.length} trang</span>
                <span className="font-mono text-xs tabular-nums opacity-70 sm:hidden">
                  {pages.length}
                </span>
              </>
            ) : (
              "Xuất PDF"
            )}
          </Button>
        </div>
      </div>

      <Sheet
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Thêm trang"
        description="Mỗi ảnh là một trang trong tài liệu."
        footer={
          adding ? (
            <p className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý…
            </p>
          ) : null
        }
      >
        <div className="p-5">
          <AddSourcePad
            onFiles={addFiles}
            onCamera={() => {
              setShowCapture(true);
              setShowAdd(false);
            }}
          />
        </div>
      </Sheet>

      {showCapture && (
        <CameraCapture
          onClose={() => setShowCapture(false)}
          onCaptured={(file) => addFile(file)}
        />
      )}

      {editing && (
        <PageEditor
          key={editing.id}
          page={editing}
          open={!!editing}
          onApply={(patch) => {
            updatePage(editing.id, patch);
            setEditingId(null);
          }}
          onApplyToAll={applyPaperToAll}
          onClose={() => setEditingId(null)}
        />
      )}

      {/* Mounted only while open: next/dynamic loads its chunk when the
          component first renders, so keeping them always-mounted forced the
          pdf-lib + Tesseract chunk (~424 KB) onto every first visit. */}
      {showExport && (
        <ExportSheet
          open
          onClose={() => setShowExport(false)}
          pages={pages}
        />
      )}

      {showPreview && (
        <PreviewSheet
          open
          onClose={() => setShowPreview(false)}
          pages={pages}
          onApplyPaperToAll={applyPaperToAll}
          onExport={() => {
            setShowPreview(false);
            setShowExport(true);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteDoc}
        title="Xóa tài liệu?"
        description={`“${docName}” và toàn bộ trang trong đó sẽ bị xóa khỏi thiết bị. Không thể hoàn tác.`}
        confirmLabel="Xóa tài liệu"
        onConfirm={deleteCurrentDoc}
        onClose={() => setConfirmDeleteDoc(false)}
      />
    </div>
  );
}
