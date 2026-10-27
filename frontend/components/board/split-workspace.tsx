"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/cn";
import { capacityOf, LAYOUT_LABEL, type SplitLayout } from "@/hooks/use-shell-store";

/**
 * Doc 06 §7.3 — split workbench layout core. `minmax(0,1fr)` everywhere and
 * `min-h-0` on every ancestor are mandatory; a bare `1fr` lets a 4 000-char log
 * line push siblings off-screen.
 */

const LAYOUT_CLASS: Record<SplitLayout, string> = {
  "1x1": "grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]",
  "1x2": "grid-cols-[minmax(0,1fr)] md:grid-cols-[repeat(2,minmax(0,1fr))] grid-rows-[minmax(0,1fr)]",
  "2x2": "grid-cols-[minmax(0,1fr)] md:grid-cols-[repeat(2,minmax(0,1fr))] grid-rows-[repeat(auto-fit,minmax(0,1fr))]",
  "2x3": "grid-cols-[minmax(0,1fr)] hud-dual:grid-cols-[repeat(3,minmax(0,1fr))] grid-rows-[repeat(auto-fit,minmax(0,1fr))]",
};

export type SplitWorkspaceProps = {
  layout: SplitLayout;
  renderCell: (slot: number, occupied: boolean) => ReactNode;
  occupiedSlots?: readonly number[];
  onLayoutChange?: (layout: SplitLayout) => void;
  showControl?: boolean;
  className?: string;
};

export function SplitWorkspace({
  layout,
  renderCell,
  occupiedSlots,
  onLayoutChange,
  showControl = true,
  className,
}: SplitWorkspaceProps) {
  const capacity = capacityOf(layout);
  const occupied = occupiedSlots ?? [];

  return (
    <section aria-label="Split workspace" className={cn("flex min-h-0 min-w-0 flex-col gap-1", className)}>
      {showControl && onLayoutChange ? (
        <div className="flex shrink-0 items-center justify-end gap-1" aria-label="Split layout">
          {(Object.keys(LAYOUT_LABEL) as SplitLayout[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onLayoutChange(option)}
              aria-pressed={option === layout}
              title={`${LAYOUT_LABEL[option]} layout (${LAYOUT_LABEL[option] === "1×1" ? "1 pane" : "split"})`}
              className={cn(
                "rounded-chip border px-1.5 font-machine text-hud-micro tabular-nums transition-colors duration-100",
                option === layout
                  ? "border-flow/40 bg-flow-tint text-flow"
                  : "border-grid text-muted hover:border-grid-strong hover:text-primary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow",
              )}
            >
              {LAYOUT_LABEL[option]}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-px overflow-hidden rounded-hud bg-grid [contain:layout_paint]",
          LAYOUT_CLASS[layout],
        )}
      >
        {Array.from({ length: capacity }, (_, slot) => (
          <div key={slot} className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-canvas [contain:layout_paint]">
            {renderCell(slot, occupied.includes(slot))}
          </div>
        ))}
      </div>
    </section>
  );
}
