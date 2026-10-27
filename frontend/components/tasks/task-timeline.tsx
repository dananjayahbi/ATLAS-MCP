"use client";

import { cn } from "@/lib/format/cn";
import { formatRelativeTime } from "@/lib/format/duration";
import { formatTime } from "@/lib/sse/export";
import type { TaskEventDTO } from "@/lib/types/api";
import { LOG_LEVEL_META } from "@/lib/format/tone";
import { EmptyState } from "@/components/ui/empty-state";

/** Doc 06 §7.2 row 6 — the task's own event history (`TaskDetailDTO.recent_events`). */

export type TaskTimelineProps = {
  events: readonly TaskEventDTO[];
  className?: string;
  limit?: number;
};

export function TaskTimeline({ events, className, limit = 50 }: TaskTimelineProps) {
  if (events.length === 0) {
    return <EmptyState inline title="No events yet" hint="Activity appears as the task moves through its lifecycle." />;
  }

  const rows = events.slice(-limit).reverse();

  return (
    <ol className={cn("flex flex-col gap-1", className)} aria-label="Task event history">
      {rows.map((event) => {
        const meta = LOG_LEVEL_META[event.level];
        return (
          <li
            key={event.id}
            className="flex min-w-0 items-baseline gap-1.5 rounded-chip border border-grid/60 bg-inset/40 px-1.5 py-0.5"
          >
            <span aria-hidden className={cn("shrink-0 font-machine text-hud-micro", meta.className)}>
              {meta.glyph}
            </span>
            <time
              dateTime={event.ts}
              title={event.ts}
              className="shrink-0 font-machine text-hud-micro tabular-nums text-muted"
            >
              {formatTime(event.ts)}
            </time>
            <span className="shrink-0 font-machine text-hud-micro uppercase tracking-[0.06em] text-flow">
              {event.type}
            </span>
            <span className="min-w-0 flex-1 truncate text-hud-micro text-secondary" title={event.message}>
              {event.message}
            </span>
            <span className="shrink-0 font-machine text-hud-micro text-disabled">
              {formatRelativeTime(event.ts)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
