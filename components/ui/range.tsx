"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A labelled range slider.
 *
 * `accent-primary` on a bare <input type="range"> gave three different-looking
 * sliders (sharpen, dewarp, brightness/contrast/saturation, quality) whose
 * tracks were the browser's own thin grey default. Here the track is redrawn so
 * the filled part is the phosphor accent: the instrument reading and the state
 * are the same mark, which is the whole point of a scanner's density scale.
 *
 * The native input stays underneath, unchanged and keyboard-operable, with only
 * its track and thumb painted.
 */
export function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  lowLabel,
  highLabel,
  hint,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** How the current value is written next to the label. */
  format?: (value: number) => string;
  lowLabel?: string;
  highLabel?: string;
  hint?: string;
  className?: string;
}) {
  const id = React.useId();
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn("group", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        <span className="font-mono text-xs tabular-nums text-foreground">
          {format ? format(value) : value}
        </span>
      </div>
      <div className="relative flex h-6 items-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          className="relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-foreground [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-runnable-track]:bg-transparent focus-visible:[&::-webkit-slider-thumb]:ring-[3px] focus-visible:[&::-webkit-slider-thumb]:ring-ring"
        />
      </div>
      {(lowLabel || highLabel) && (
        <div className="mt-0.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
      {hint && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
