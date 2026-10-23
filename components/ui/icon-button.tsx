import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A square icon action. `rounded-full` like the buttons it sits beside, so the
 * page grid's rotate / delete / edit never reads as a different control family
 * from the bar underneath.
 */
export function IconButton({
  className,
  type = "button",
  tone = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "overlay" | "danger";
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35",
        tone === "default" &&
          "h-10 w-10 text-muted-foreground hover:bg-accent hover:text-foreground",
        // Sits on top of a photo, so it needs its own contrast regardless of
        // what the scan underneath happens to be.
        tone === "overlay" &&
          "h-9 w-9 bg-black/50 text-white backdrop-blur-sm hover:bg-black/70",
        tone === "danger" && "h-10 w-10 hover:bg-destructive/15 hover:text-destructive",
        className,
      )}
      {...props}
    />
  );
}
