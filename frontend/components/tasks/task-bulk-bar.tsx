"use client";

import { useState } from "react";
import { cn } from "@/lib/format/cn";
import type { TaskSummaryDTO } from "@/lib/types/api";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/**
 * Doc 06 §8.7 — the bulk bar. Requeue requires rejected tasks; archive is
 * available for any selection and needs a typed confirm.
 */

export type TaskBulkBarProps = {
  selected: readonly TaskSummaryDTO[];
  onClear: () => void;
  onSetPriority: (priority: number) => void;
  onNudge: (delta: number) => void;
  onRequeue: () => void;
  onArchive: () => void;
  busy?: boolean;
  progress?: { done: number; total: number };
  error?: string | null;
  className?: string;
};

const ARCHIVE_CONFIRM = "ARCHIVE";

export function TaskBulkBar({
  selected,
  onClear,
  onSetPriority,
  onNudge,
  onRequeue,
  onArchive,
  busy = false,
  progress,
  error,
  className,
}: TaskBulkBarProps) {
  const [priority, setPriority] = useState(50);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  if (selected.length === 0) return null;

  const allRejected = selected.every((task) => task.status === "REJECTED");
  const shared = selected[0]?.priority ?? 50;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-1.5 rounded-hud border border-flow/40 bg-flow-tint/30 px-2 py-1",
        className,
      )}
    >
      <span className="shrink-0 font-machine text-hud-micro uppercase tracking-[0.06em] text-flow">
        {selected.length} selected
      </span>

      <label className="inline-flex shrink-0 items-center gap-1 font-machine text-hud-micro uppercase text-muted">
        set P
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          value={priority}
          aria-label="Absolute priority"
          onChange={(event) => setPriority(Number(event.target.value))}
          className="h-6 w-14 rounded-chip border border-grid bg-canvas px-1 font-machine text-hud-micro tabular-nums text-secondary"
        />
      </label>
      <Button size="sm" onClick={() => onSetPriority(priority)} disabled={busy}>
        Apply
      </Button>
      <Button size="sm" onClick={() => onNudge(5)} disabled={busy} aria-label="Increase priority by 5">
        +5
      </Button>
      <Button size="sm" onClick={() => onNudge(-5)} disabled={busy} aria-label="Decrease priority by 5">
        −5
      </Button>

      <span aria-hidden className="mx-0.5 h-4 w-px bg-grid" />

      <Button
        size="sm"
        onClick={onRequeue}
        disabled={busy || !allRejected}
        title={allRejected ? "T13: REJECTED → PENDING" : "Only REJECTED tasks can be requeued"}
      >
        Requeue
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        Archive
      </Button>

      {progress && busy ? (
        <span className="font-machine text-hud-micro tabular-nums text-secondary">
          {progress.done}/{progress.total}
        </span>
      ) : null}

      <span className="min-w-0 flex-1" />
      <span className="font-machine text-hud-micro tabular-nums text-disabled">shared P{shared}</span>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
        Clear <Kbd size="xs">Esc</Kbd>
      </Button>

      {error ? (
        <p role="alert" className="w-full text-hud-micro text-critical-hot">
          {error}
        </p>
      ) : null}

      {confirming ? (
        <div className="flex w-full items-center gap-1.5 border-t border-grid pt-1">
          <label htmlFor="archive-confirm" className="shrink-0 text-hud-micro uppercase text-review-hot">
            Type {ARCHIVE_CONFIRM} to archive {selected.length} task(s)
          </label>
          <input
            id="archive-confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value.toUpperCase())}
            className="h-6 w-24 rounded-chip border border-critical/50 bg-canvas px-1 font-machine text-hud-micro uppercase text-primary"
            autoFocus
          />
          <Button
            size="sm"
            variant="danger"
            disabled={typed !== ARCHIVE_CONFIRM || busy}
            onClick={() => {
              setConfirming(false);
              setTyped("");
              onArchive();
            }}
          >
            Confirm archive
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setConfirming(false);
              setTyped("");
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
