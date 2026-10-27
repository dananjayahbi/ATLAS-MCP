"use client";

import { cn } from "@/lib/format/cn";
import { PRIORITY_BAR_CLASS, PRIORITY_LABEL, priorityBand } from "@/lib/format/priority";

/** Doc 05 §8.5 — 0–100 priority bar; `interactive` upgrades it to `role="slider"`. */

export type PriorityBarProps = {
  value: number;
  showValue?: boolean;
  showBand?: boolean;
  height?: 4 | 6;
  interactive?: boolean;
  onChange?: (value: number) => void;
  label?: string;
  className?: string;
};

const STEP = 5;
const PAGE = 10;

export function PriorityBar({
  value,
  showValue = true,
  showBand = false,
  height = 4,
  interactive = false,
  onChange,
  label = "Priority",
  className,
}: PriorityBarProps) {
  const band = priorityBand(value);

  const commit = (next: number) => {
    if (!onChange) return;
    onChange(Math.min(100, Math.max(0, Math.round(next))));
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div
        role={interactive ? "slider" : "progressbar"}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${value} (${PRIORITY_LABEL[band]})`}
        aria-orientation={interactive ? "horizontal" : undefined}
        tabIndex={interactive ? 0 : undefined}
        style={{ height }}
        onKeyDown={
          interactive
            ? (event) => {
                const key = event.key;
                if (key === "ArrowRight" || key === "ArrowUp") {
                  event.preventDefault();
                  commit(value + STEP);
                } else if (key === "ArrowLeft" || key === "ArrowDown") {
                  event.preventDefault();
                  commit(value - STEP);
                } else if (key === "PageUp") {
                  event.preventDefault();
                  commit(value + PAGE);
                } else if (key === "PageDown") {
                  event.preventDefault();
                  commit(value - PAGE);
                } else if (key === "Home") {
                  event.preventDefault();
                  commit(0);
                } else if (key === "End") {
                  event.preventDefault();
                  commit(100);
                }
              }
            : undefined
        }
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden rounded-chip bg-inset ring-1 ring-inset ring-grid",
          interactive && "cursor-ew-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow",
        )}
      >
        <span
          data-pulse={band === "critical" ? "priority" : undefined}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          className={cn("absolute inset-y-0 left-0 rounded-chip transition-[width] duration-150", PRIORITY_BAR_CLASS[band])}
        />
      </div>
      {showBand ? <span className="shrink-0 text-hud-micro uppercase text-muted">{PRIORITY_LABEL[band]}</span> : null}
      {showValue ? (
        <span className="w-6 shrink-0 text-right font-machine text-machine-sm tabular-nums text-primary">{value}</span>
      ) : null}
    </div>
  );
}
