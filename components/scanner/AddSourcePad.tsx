"use client";

import * as React from "react";
import { Camera, ImageUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How a page gets into the document. Exactly two sources, so they are drawn as
 * two equal targets rather than one primary and one afterthought — whichever
 * one this device supports is the right one.
 */
export function AddSourcePad({
  onFiles,
  onCamera,
}: {
  onFiles: (files: File[]) => void;
  onCamera: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const target =
    "group flex flex-col items-start gap-2 rounded-xl border border-border-strong bg-card px-4 py-4 text-left transition-colors hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring";

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={target}
        >
          <ImageUp
            className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold">Chọn ảnh</span>
          <span className="text-[11px] leading-snug text-muted-foreground">
            Có sẵn trong máy
          </span>
        </button>
        <button type="button" onClick={onCamera} className={cn(target)}>
          <Camera
            className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold">Chụp trang</span>
          <span className="text-[11px] leading-snug text-muted-foreground">
            Dùng camera
          </span>
        </button>
      </div>
    </div>
  );
}
