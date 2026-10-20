"use client";

import * as React from "react";
import { Sheet } from "./sheet";
import { Button } from "./button";

/** A small modal used in place of window.confirm(): it inherits the sheet's
 *  focus trap and safe-area padding, and matches the rest of the UI. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Xóa",
  cancelLabel = "Hủy",
  destructive = true,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            className="flex-1"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {description && (
        <p className="px-5 py-4 text-sm text-muted-foreground">{description}</p>
      )}
    </Sheet>
  );
}
