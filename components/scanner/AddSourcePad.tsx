"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Camera, ImageUp } from "lucide-react";

export function AddSourcePad({
  onFiles,
  onCamera,
}: {
  onFiles: (files: File[]) => void;
  onCamera: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

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
        <Button
          variant="secondary"
          size="lg"
          onClick={() => inputRef.current?.click()}
        >
          <ImageUp className="h-5 w-5" />
          <span className="flex flex-col items-start leading-tight">
            Tải ảnh
            <span className="text-xs font-normal opacity-70">từ thiết bị</span>
          </span>
        </Button>
        <Button variant="secondary" size="lg" onClick={onCamera}>
          <Camera className="h-5 w-5" />
          <span className="flex flex-col items-start leading-tight">
            Chụp ảnh
            <span className="text-xs font-normal opacity-70">bằng camera</span>
          </span>
        </Button>
      </div>
    </div>
  );
}
