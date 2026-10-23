"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * An on/off processing step (khử bóng, tăng nét, uốn cong).
 *
 * These used to be pills containing a fake 8px checkbox with a "✓" character,
 * which read as decorative rather than as a real state — and an unavailable one
 * still showed an empty box that looked tappable. A switch states the state,
 * and `disabled` + a hint explains why it cannot be changed.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  disabledHint,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** What the step does, shown under the label in plain words. */
  hint?: string;
  disabled?: boolean;
  /** Why the switch is unavailable — shown instead of the hint. */
  disabledHint?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors",
        "hover:border-border-strong hover:bg-accent/60",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-card",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-medium",
            disabled && "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {(disabled ? disabledHint : hint) && (
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            {disabled ? disabledHint : hint}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors",
          checked && !disabled
            ? "border-transparent bg-primary"
            : // Off: a recessed track with a visible knob. Using --primary on the
              // on state and --muted on the off state (both from the same scale)
              // keeps the knob legible in light mode too, where a dark primary
              // paired with the dark on-color used to vanish.
              "border-border-strong bg-muted",
          disabled && "opacity-50",
        )}
      >
        <span
          className={cn(
            "absolute h-4 w-4 rounded-full shadow-sm transition-transform",
            checked && !disabled
              ? "translate-x-[1.375rem] bg-primary-foreground"
              : "translate-x-1 bg-foreground",
          )}
        />
      </span>
    </button>
  );
}
