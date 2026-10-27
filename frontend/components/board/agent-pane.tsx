"use client";

import { useState } from "react";
import { cn } from "@/lib/format/cn";
import { formatAgeHours } from "@/lib/format/duration";
import { shortTaskId } from "@/lib/format/path";
import { STATUS_META } from "@/lib/format/tone";
import type { TaskDetailDTO } from "@/lib/types/api";
import type { AssetDTO } from "@/lib/types/enums";
import { PriorityChip, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentPaneBody } from "./agent-pane-body";

/**
 * Doc 06 §7.2 — the live pane. Rows 1–3 are `shrink-0`, the terminal row is
 * `min-h-0 flex-1`, and only the terminal scrolls (§7.3 item 5).
 */

export type AgentPaneProps = {
  slot: number;
  projectSlug: string | null;
  task: TaskDetailDTO | null;
  loading?: boolean;
  focused?: boolean;
  onFocus?: () => void;
  onSubmitForReview?: () => void;
  onForceRelease?: () => void;
  onOpenTask?: () => void;
  onClear?: () => void;
  className?: string;
};

export function AgentPane({
  slot,
  projectSlug,
  task,
  loading = false,
  focused = false,
  onFocus,
  onSubmitForReview,
  onForceRelease,
  onOpenTask,
  onClear,
  className,
}: AgentPaneProps) {
  const [canvasAsset, setCanvasAsset] = useState<AssetDTO | null>(null);

  if (!projectSlug) {
    return (
      <div className={cn("flex min-h-0 flex-col", className)}>
        <EmptyState
          inline
          title="Assign a workspace"
          hint={`Slot ${slot + 1} is empty. Pick a project from the rail or the project switcher.`}
        />
      </div>
    );
  }

  if (loading && !task) {
    return (
      <div className={cn("flex min-h-0 flex-col gap-2 p-2", className)}>
        <Skeleton lines={2} dense />
        <Skeleton lines={4} />
      </div>
    );
  }

  if (!task) {
    return (
      <div className={cn("flex min-h-0 flex-col", className)} tabIndex={-1}>
        <EmptyState
          inline
          title={`${projectSlug} · waiting for claim`}
          hint="No task selected for this slot. The agent claims the highest-priority PENDING task."
        />
      </div>
    );
  }

  const locked = task.status === "IN_REVIEW" || task.status === "COMPLETED";

  return (
    <div
      tabIndex={-1}
      onFocusCapture={onFocus}
      aria-label={`Pane ${slot + 1}: ${task.title}`}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden [contain:layout_paint]",
        focused && "ring-1 ring-flow/40",
        className,
      )}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-grid px-2 py-1">
        <span className="font-machine text-hud-micro uppercase text-disabled">{shortTaskId(task.id)}</span>
        <button
          type="button"
          onClick={onOpenTask}
          className="min-w-0 flex-1 truncate text-left text-hud-bodylg font-medium text-primary hover:text-flow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          title={task.title}
        >
          {task.title}
        </button>
        <PriorityChip priority={task.priority} />
        <StatusBadge status={task.status} />
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear slot ${slot + 1}`}
            title="Close pane assignment (Shift+W)"
            className="shrink-0 rounded-chip px-1 text-disabled hover:text-critical-hot focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          >
            ✕
          </button>
        ) : null}
      </header>

      <AgentPaneBody
        task={task}
        canvasAsset={canvasAsset}
        onCanvasChange={setCanvasAsset}
        onSubmitForReview={onSubmitForReview}
        onForceRelease={onForceRelease}
        locked={locked}
      />

      <div className="flex shrink-0 items-center gap-2 px-2 py-0.5 font-machine text-hud-micro text-disabled">
        <span className="min-w-0 truncate" style={{ color: STATUS_META[task.status].cssVar }}>
          {STATUS_META[task.status].label}
        </span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatAgeHours(task.age_hours)} old</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{task.dod_progress_percent}% DoD</span>
      </div>
    </div>
  );
}
