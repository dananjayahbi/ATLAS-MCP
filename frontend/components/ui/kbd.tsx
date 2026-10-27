import type { ReactNode } from "react";
import { cn } from "@/lib/format/cn";

/** Doc 05 §8.12 — keycap chip for hotkey hints. */

export type KbdProps = {
  children: ReactNode;
  size?: "xs" | "sm";
  dim?: boolean;
  className?: string;
};

export function Kbd({ children, size = "xs", dim = false, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded-chip border border-grid bg-inset px-1 font-machine tabular-nums",
        size === "xs" ? "h-4 text-hud-micro" : "h-5 text-machine-sm",
        dim ? "text-disabled" : "text-secondary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Platform-aware modifier glyph used by every hint string in Doc 06 §12.1. */
export function modKey(): string {
  if (typeof navigator === "undefined") return "⌘";
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
}
