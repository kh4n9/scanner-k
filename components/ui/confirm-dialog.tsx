"use client";

import * as React from "react";
import { Sheet } from "./sheet";
import { Button } from "./button";

/** A small modal used in place of window.confirm(): it inherits the sheet's
 *  focus trap and safe-area padding, and matches the rest of the UI. The
 *  destructive action is the only filled button in the dialog, and it states
 *  the consequence by naming the thing it deletes. */
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
      className="sm:max-w-sm"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} autoFocus>
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
        <p className="px-5 py-4 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </Sheet>
  );
}
