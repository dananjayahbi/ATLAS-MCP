"use client";

import Link from "next/link";
import { cn } from "@/lib/format/cn";
import { formatAgeHours, formatCountdown, formatDuration } from "@/lib/format/duration";
import { formatPriority } from "@/lib/format/priority";
import { LEASE_CLASS, leaseTone, STATUS_META } from "@/lib/format/tone";
import type { AssetPreview } from "@/lib/api/assets";
import type { TaskSummaryDTO } from "@/lib/types/api";
import { Badge, PriorityChip, StatusBadge } from "@/components/ui/badge";import { Gauge } from "@/components/ui/gauge";
import { TaskThumbnailGrid } from "@/components/tasks/task-thumbnail-grid";

/** Doc 06 §8.1 — one task row/card over `TaskSummaryDTO`. Never re-derives aggregates. */

export type TaskCardProps = {
  task: TaskSummaryDTO;
  active?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
  href?: string;
  compact?: boolean;
  className?: string;
  /** Board thumbnails from the batched preview index (`useTaskAssetPreviews`). */
  thumbnails?: readonly AssetPreview[];
  thumbnailTotal?: number;
  onOpenImage?: (taskId: string, assetId: string) => void;
  /** Opens the edit dialog; omitted when the caller has no handler. */
  onEdit?: (id: string) => void;
  /** Enables HTML5 drag for status moves (board only, never the list view). */
  draggable?: boolean;
};

function ChipRow({ task }: { task: TaskSummaryDTO }) {
  const stale = task.status === "PENDING" && task.age_hours > 48;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {task.is_blocked ? (
        <Badge tone="review" title="Blocked">
          <span aria-hidden>⛔</span>BLOCKED
        </Badge>
      ) : null}
      {stale ? <Badge tone="review">STALE</Badge> : null}
      {task.is_agent_discovered ? (
        <Badge tone="review">
          <span aria-hidden>⚡</span>DISCOVERED
        </Badge>
      ) : null}
      {task.parent_task_id ? <Badge tone="neutral">SUBTASK</Badge> : null}
    </div>
  );
}

export function TaskCard({
  task,
  active,
  selected,
  onSelect,
  onOpen,
  href,
  compact = false,
  className,
  thumbnails,
  thumbnailTotal,
  onOpenImage,
  onEdit,
  draggable = false,
}: TaskCardProps) {
  const lease = formatCountdown(task.lease_seconds_remaining);
  const hrefTo = href ?? `/projects/${task.project_slug}/tasks/${task.id}`;

  return (
    <article
      aria-current={active ? "true" : undefined}
      data-selected={selected || undefined}
      data-task-id={draggable ? task.id : undefined}
      draggable={draggable || undefined}
      onDragStart={
        draggable
          ? (event) => {
              event.dataTransfer.setData("text/atlas-task", task.id);
              // Some browsers only expose `text/plain` to a drop handler.
              event.dataTransfer.setData("text/plain", task.id);
              event.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      className={cn(
        "group relative min-w-0 rounded-hud border bg-panel/80 transition-colors duration-100",
        active ? "border-flow/60" : "border-grid hover:border-grid-strong",
        selected && "bg-flow-tint/40",
        draggable && "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      <div className={cn("flex min-w-0 flex-col gap-1", compact ? "p-1.5" : "p-2")}>
        <div className="flex min-w-0 items-center gap-1.5">
          <PriorityChip priority={task.priority} />
          <StatusBadge status={task.status} />
          {task.lease_seconds_remaining !== null ? (
            <span
              className={cn("ml-auto shrink-0 font-machine text-hud-micro tabular-nums", LEASE_CLASS[leaseTone(task.lease_seconds_remaining)])}
              title={`Lease ${formatDuration(task.lease_seconds_remaining)} remaining`}
            >
              ⏱ {lease}
            </span>
          ) : null}
          {onSelect ? (
            <button
              type="button"
              aria-pressed={selected ?? false}
              aria-label={`${selected ? "Deselect" : "Select"} ${task.title}`}
              onClick={() => onSelect(task.id)}
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-chip border text-hud-micro",
                selected ? "border-flow bg-flow-tint text-flow" : "border-grid text-disabled hover:text-primary",
              )}
            >
              {selected ? "✓" : ""}
            </button>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              aria-label={`Edit ${task.title}`}
              title="Edit task"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEdit(task.id);
              }}
              className="ml-auto shrink-0 rounded-chip px-1 font-machine text-hud-micro text-disabled opacity-0 transition-opacity duration-100 hover:text-flow focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow group-hover:opacity-100"
            >
              edit
            </button>
          ) : null}
        </div>

        <Link
          href={hrefTo}
          onClick={() => onOpen?.(task.id)}
          className="min-w-0 truncate text-hud-bodylg font-medium text-primary hover:text-flow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          title={task.title}
        >
          {task.title}
        </Link>

        <Gauge value={task.dod_progress_percent} size="sm" showLabel={false} />

        {thumbnails && thumbnails.length > 0 ? (
          <TaskThumbnailGrid
            images={thumbnails}
            total={thumbnailTotal ?? thumbnails.length}
            onOpen={(assetId) => onOpenImage?.(task.id, assetId)}
          />
        ) : null}

        <div className="flex min-w-0 items-center gap-2 text-hud-micro text-muted">
          <span className="font-machine tabular-nums">{formatAgeHours(task.age_hours)} old</span>
          <span aria-hidden>·</span>
          <span className="font-machine tabular-nums">{task.dod_progress_percent}% DoD</span>
          {task.dependency_weight > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className="font-machine tabular-nums">dep {task.dependency_weight}</span>
            </>
          ) : null}
          <span className="ml-auto shrink-0 font-machine text-hud-micro text-disabled">{formatPriority(task.priority)}</span>
        </div>

        {!compact ? <ChipRow task={task} /> : null}
      </div>
    </article>
  );
}

/** Small variant for the matrix tooltip / queue previews. */
export function TaskCardMini({ task, className }: { task: TaskSummaryDTO; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <span aria-hidden style={{ color: STATUS_META[task.status].cssVar }}>
        {STATUS_META[task.status].glyph}
      </span>
      <span className="min-w-0 flex-1 truncate font-machine text-machine-sm text-secondary">{task.title}</span>
      <span className="shrink-0 font-machine text-hud-micro tabular-nums text-muted">{formatPriority(task.priority)}</span>
    </div>
  );
}
