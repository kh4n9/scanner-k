"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one way to pick one option out of two to five.
 *
 * Before this existed the app had three different selection controls for the
 * same job: a native <select> for document paper, pills for editor paper and
 * filter, and fake checkboxes with a "✓" text glyph for toggles. They now share
 * this component, so a choice looks the same and works the same everywhere.
 *
 * `role="radiogroup"` with roving arrow keys is deliberate: these are mutually
 * exclusive choices, and a screen reader saying "radio, 2 of 4" is more useful
 * than three unrelated buttons. Each option keeps a real accessible name, and
 * the group carries the question it answers.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  size = "md",
  wrap = "row",
}: {
  /** The question the options answer, e.g. "Kích thước giấy". */
  label?: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
  /** `row` when the options fit on one line; `wrap` lets narrow containers put
   *  them on two lines instead of squeezing the labels into ellipses. */
  wrap?: "row" | "wrap";
}) {
  const groupRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  const move = (dir: 1 | -1) => {
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + dir + options.length) % options.length];
    onChange(next.value);
    // Follow the selection with focus, the way a radio group does.
    requestAnimationFrame(() => {
      groupRef.current
        ?.querySelectorAll<HTMLElement>('[role="radio"]')
        ?.[options.findIndex((o) => o.value === next.value)]?.focus();
    });
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={label ? undefined : `${id}-none`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
      className={cn(
        "relative grid gap-1 rounded-full border border-border bg-muted p-1",
        wrap === "wrap" && "grid-cols-2 sm:grid-cols-none sm:auto-cols-fr sm:grid-flow-col",
        className,
      )}
      style={
        wrap === "row"
          ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
              size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {opt.label}
            {opt.hint && (
              <span
                className={cn(
                  "font-mono text-[10px] tabular-nums",
                  active ? "opacity-70" : "opacity-60",
                )}
              >
                {opt.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
