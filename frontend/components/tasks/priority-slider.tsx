"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/format/cn";
import { clampPriority, PRIORITY_LABEL, priorityBand, formatPriority } from "@/lib/format/priority";
import { PriorityBar } from "@/components/ui/priority-bar";
import { Button } from "@/components/ui/button";

/** Doc 06 §12.1 #39 / §3.5 — 250 ms trailing commit, integer values only. */

export type PrioritySliderProps = {
  value: number;
  onCommit: (priority: number) => void;
  disabled?: boolean;
  suggested?: number | null;
  className?: string;
};

export function PrioritySlider({ value, onCommit, disabled = false, suggested = null, className }: PrioritySliderProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = (next: number) => {
    const clamped = clampPriority(next);
    setDraft(clamped);
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div className={cn("flex flex-col gap-1", className)} aria-label="Priority editor">
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={draft}
          disabled={disabled}
          aria-label="Priority"
          aria-valuetext={`${draft} ${PRIORITY_LABEL[priorityBand(draft)]}`}
          onChange={(event) => setDraft(Number(event.target.value))}
          onPointerUp={() => commit(draft)}
          onKeyUp={() => commit(draft)}
          onBlur={() => commit(draft)}
          className="h-1 min-w-0 flex-1 cursor-ew-resize accent-[var(--color-flow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
        />
        <span className="w-8 shrink-0 text-right font-machine text-machine-sm tabular-nums text-primary">
          {formatPriority(draft)}
        </span>
      </div>
      <PriorityBar value={draft} showValue={false} height={4} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-hud-micro uppercase tracking-[0.08em] text-muted">
          {PRIORITY_LABEL[priorityBand(draft)]}
          {suggested !== null && suggested !== draft ? (
            <span className="ml-1 font-machine normal-case text-review-hot">suggested {suggested} → {draft}</span>
          ) : null}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" onClick={() => commit(draft - 5)} disabled={disabled} aria-label="Decrease priority by 5">
            −5
          </Button>
          <Button size="sm" onClick={() => commit(draft + 5)} disabled={disabled} aria-label="Increase priority by 5">
            +5
          </Button>
        </div>
      </div>
    </div>
  );
}
