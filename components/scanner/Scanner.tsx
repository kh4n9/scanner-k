"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, FilePlus2, Loader2, ScanHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AddSourcePad } from "./AddSourcePad";
import { CameraCapture } from "./CameraCapture";
import { PageEditor } from "./PageEditor";
import { PagesGrid } from "./PagesGrid";
import { ExportSheet } from "./ExportSheet";
import { computeAutoAdjust, detectDocBoundary, fileToSrc } from "@/lib/image";
import { uid } from "@/lib/utils";
import { NEUTRAL_ADJUST } from "@/lib/types";
import {
  deleteDocument,
  listDocuments,
  loadDocument,
  saveDocument,
} from "@/lib/db";
import type { DocMeta, StoredDoc, StoredPage } from "@/lib/db";
import type { Adjust, Point, ScanPage } from "@/lib/types";

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
    rotation: p.rotation ?? 0,
    dewarpStrength: p.dewarpStrength ?? 0,
    image,
    mime,
  };
}

function revokePages(ps: ScanPage[]) {
  for (const p of ps) URL.revokeObjectURL(p.src);
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
    rotation: p.rotation,
    dewarpStrength: p.dewarpStrength,
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
  const [adding, setAdding] = React.useState(false);

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
    try {
      boundary = await detectDocBoundary(src);
    } catch {
      boundary = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
    }
    let adjust: Adjust = { ...NEUTRAL_ADJUST };
    let shadow = false;
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

  const deletePage = React.useCallback((id: string) => {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.src);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

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

  const renameDoc = () => {
    const name = window.prompt("Tên tài liệu", docName);
    if (name && name.trim()) setDocName(name.trim());
  };

  const deleteCurrentDoc = async () => {
    if (!docId) return;
    if (!window.confirm("Xóa tài liệu này?")) return;
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
    <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-5">
      <header className="mb-5 flex items-center gap-3">
        <Link
          href="/"
          aria-label="Về trang chủ"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold leading-tight">{docName}</h1>
          <p className="text-xs text-muted-foreground">
            {pages.length === 0
              ? "Chưa có trang"
              : `${pages.length} trang sẽ được gộp thành PDF`}
          </p>
        </div>
      </header>

      {showDocBar && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
          <label className="sr-only" htmlFor="doc-select">
            Chọn tài liệu
          </label>
          <select
            id="doc-select"
            className="h-9 flex-1 rounded-lg border border-border bg-transparent px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
          <Button variant="secondary" size="sm" onClick={newDoc}>
            Mới
          </Button>
          <Button variant="secondary" size="sm" onClick={renameDoc}>
            Đổi tên
          </Button>
          <Button variant="secondary" size="sm" onClick={deleteCurrentDoc} disabled={!docId}>
            Xóa
          </Button>
        </div>
      )}

      {restoring ? (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang mở tài liệu…
        </p>
      ) : pages.length === 0 ? (
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-14 text-center">
          <div className="scan-beam" />
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <ScanHeart className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold">Quét tài liệu thành PDF</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Chụp hoặc tải ảnh các trang giấy, chỉnh cắt và gộp thành một file
            PDF ngay trên thiết bị của bạn.
          </p>
          <div className="mx-auto mt-6 max-w-md">
            <AddSourcePad
              onFiles={addFiles}
              onCamera={() => {
                setShowCapture(true);
                setShowAdd(false);
              }}
            />
          </div>
          {adding && (
            <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang thêm ảnh…
            </p>
          )}
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

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={() => setShowAdd(true)}
          >
            <FilePlus2 className="h-5 w-5" />
            Thêm trang
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={pages.length === 0}
            onClick={() => setShowExport(true)}
          >
            {pages.length > 0 ? `Xuất PDF (${pages.length})` : "Xuất PDF"}
          </Button>
        </div>
      </div>

      <Sheet
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Thêm trang"
        footer={
          adding ? (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
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
          onClose={() => setEditingId(null)}
        />
      )}

      <ExportSheet
        open={showExport}
        onClose={() => setShowExport(false)}
        pages={pages}
      />
    </div>
  );
}
