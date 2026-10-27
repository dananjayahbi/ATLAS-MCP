"use client";

import { cn } from "@/lib/format/cn";
import { formatAgeHours } from "@/lib/format/duration";
import { PRIORITY_GROUPS, priorityBand, PRIORITY_LABEL, PRIORITY_TEXT_CLASS } from "@/lib/format/priority";
import { STATUS_META, TASK_STATUS_ORDER } from "@/lib/format/tone";
import type { TaskSummaryDTO } from "@/lib/types/api";
import { Tabs } from "@/components/ui/tabs";
import { BoardColumn } from "./board-column";
import { TaskCard } from "./task-card";

/** Doc 06 §8.4 — board over `TaskSummaryDTO[]`, grouped by status or priority band. */

export type BoardGrouping = "status" | "priority";

export type TaskBoardViewProps = {
  tasks: readonly TaskSummaryDTO[];
  group: BoardGrouping;
  onGroupChange: (group: BoardGrouping) => void;
  activeTaskId?: string | null;
  selectedIds?: ReadonlySet<string>;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
  className?: string;
};

type Bucket = { id: string; label: string; rows: TaskSummaryDTO[]; status: keyof typeof STATUS_META | null };

function bucketById(tasks: readonly TaskSummaryDTO[], group: BoardGrouping): Bucket[] {
  if (group === "priority") {
    return PRIORITY_GROUPS.map((band) => ({
      id: band.id,
      label: band.label,
      status: null,
      rows: tasks.filter((task) => task.priority >= band.min && task.priority <= band.max),
    }));
  }
  const present = new Set(tasks.map((task) => task.status));
  return TASK_STATUS_ORDER.filter((status) => present.has(status) || status !== "PENDING_APPROVAL").map((status) => ({
    id: status,
    label: STATUS_META[status].label,
    status,
    rows: tasks.filter((task) => task.status === status),
  }));
}

export function TaskBoardView({
  tasks,
  group,
  onGroupChange,
  activeTaskId,
  selectedIds,
  onSelect,
  onOpen,
  className,
}: TaskBoardViewProps) {
  const buckets = bucketById(tasks, group);
  const oldest = tasks.reduce((max, task) => Math.max(max, task.age_hours), 0);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="flex shrink-0 items-center gap-2">
        <Tabs
          items={[
            { id: "status", label: "Status" },
            { id: "priority", label: "Priority" },
          ]}
          value={group}
          onChange={(id) => onGroupChange(id as BoardGrouping)}
        />
        <span className="font-machine text-hud-micro tabular-nums text-muted">{tasks.length} tasks</span>
        <span className="min-w-0 flex-1" />
        <span className="font-machine text-hud-micro text-disabled">oldest {formatAgeHours(oldest)}</span>
      </div>

      <div
        role="grid"
        aria-label="Task board"
        className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-1.5 overflow-hidden"
      >
        {buckets.map((bucket) => (
          <BoardColumn
            key={bucket.id}
            id={bucket.id}
            label={bucket.label}
            count={bucket.rows.length}
            glyph={bucket.status ? STATUS_META[bucket.status].glyph : undefined}
            accentVar={bucket.status ? STATUS_META[bucket.status].cssVar : undefined}
            emptyText={group === "status" ? "No tasks" : "Empty band"}
          >
            {bucket.rows.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                active={task.id === activeTaskId}
                selected={selectedIds?.has(task.id) ?? false}
                onSelect={onSelect}
                onOpen={onOpen}
                compact
              />
            ))}
          </BoardColumn>
        ))}
      </div>

      {group === "priority" ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {PRIORITY_GROUPS.map((band) => (
            <span
              key={band.id}
              className={cn(
                "rounded-chip border border-grid px-1 font-machine text-hud-micro uppercase",
                PRIORITY_TEXT_CLASS[priorityBand(band.min)],
              )}
            >
              {band.label} {PRIORITY_LABEL[priorityBand(band.min)]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
