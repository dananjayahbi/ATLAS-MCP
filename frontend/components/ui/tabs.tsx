"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/cn";

/** Doc 05 §8.8 — segmented switch with roving tabindex and arrow-key cycling. */

export type TabItem = { id: string; label: string; badge?: ReactNode };

export type TabsProps = {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  size?: "sm" | "md";
  className?: string;
};

export function Tabs({ items, value, onChange, size = "sm", className }: TabsProps) {
  const move = (delta: number) => {
    const index = items.findIndex((item) => item.id === value);
    const next = items[(index + delta + items.length) % items.length];
    if (next) onChange(next.id);
  };

  return (
    <div
      role="tablist"
      aria-label="View"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          const first = items[0];
          if (first) onChange(first.id);
        } else if (event.key === "End") {
          event.preventDefault();
          const last = items[items.length - 1];
          if (last) onChange(last.id);
        }
      }}
      className={cn("inline-flex items-center gap-[2px] rounded-hud border border-grid bg-inset p-[2px]", className)}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-chip px-2 font-ui text-hud-label uppercase tracking-[0.06em] transition-colors duration-100",
              size === "sm" ? "h-6" : "h-7",
              selected ? "bg-flow-tint text-flow" : "text-secondary hover:text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow",
            )}
          >
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
