import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

/*
 * One primary per screen. The phosphor accent is the loudest thing in the
 * interface, so it is reserved for the action that moves the document forward
 * (Bắt đầu quét, Áp dụng, Tạo PDF). Everything else is an outline or a ghost,
 * which is what keeps a page of three buttons from reading as three CTAs.
 */
const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:brightness-95 active:brightness-90 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_60%,transparent),0_6px_20px_-10px_color-mix(in_oklab,var(--primary)_70%,transparent)]",
  outline:
    "border border-border-strong bg-transparent text-foreground hover:bg-accent active:bg-muted",
  secondary:
    "border border-transparent bg-muted text-foreground hover:bg-accent active:bg-muted",
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  destructive:
    "bg-destructive text-destructive-foreground hover:brightness-95 active:brightness-90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
  /** Touch-sized. Used where the button is meant to be reachable by a thumb
   *  (sheet footers), not in a bar where several sit side by side. */
  lg: "h-12 gap-2 px-5 text-base",
};

/** Shared button styling, so links can look like buttons without nesting a
 *  <button> inside an <a> (invalid HTML, and screen readers announce it twice). */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-full font-semibold transition-[background-color,color,filter,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      className={buttonClasses({ variant, size, className })}
      {...props}
    />
  );
}
