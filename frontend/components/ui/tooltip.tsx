"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/format/cn";

/** Doc 05 §8.7 — hover/focus tooltip. No portal, no focus trap. */

export type TooltipProps = {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
};

export function Tooltip({ label, children, side = "top", className }: TooltipProps) {
  const id = useId();
  return (
    <span className={cn("group relative inline-flex min-w-0", className)}>
      <span aria-describedby={id} className="inline-flex min-w-0">
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 hidden -translate-x-1/2 whitespace-nowrap rounded-chip border border-grid-strong bg-raised px-1.5 py-0.5 text-hud-micro text-primary opacity-0 shadow-hud-panel transition-opacity duration-100",
          side === "top" ? "bottom-full mb-1" : "top-full mt-1",
          "group-hover:block group-hover:opacity-100 group-focus-within:block group-focus-within:opacity-100",
        )}
      >
        {label}
      </span>
    </span>
  );
}
