import { cn } from "@/lib/format/cn";
import { formatRelativeTime } from "@/lib/format/duration";
import { formatPriority } from "@/lib/format/priority";
import { shortTaskId } from "@/lib/format/path";
import type { TaskDetailDTO } from "@/lib/types/api";

/** Doc 06 §10.1 — the left-hand queue of the review gate. */

export type ReviewQueueProps = {
  items: readonly TaskDetailDTO[];
  activeIndex: number;
  onSelect: (index: number) => void;
  loading?: boolean;
  className?: string;
};

export function ReviewQueue({ items, activeIndex, onSelect, loading = false, className }: ReviewQueueProps) {
  if (loading && items.length === 0) {
    return <p className={cn("text-hud-body text-muted", className)}>Loading queue…</p>;
  }
  if (items.length === 0) {
    return <p className={cn("text-hud-body text-muted", className)}>Nothing awaiting sign-off.</p>;
  }

  return (
    <ul role="list" aria-label="Review queue" className={cn("flex flex-col gap-0.5", className)}>
      {items.map((task, index) => (
        <li key={task.id}>
          <button
            type="button"
            onClick={() => onSelect(index)}
            aria-current={index === activeIndex ? "true" : undefined}
            className={cn(
              "flex w-full min-w-0 items-center gap-1.5 rounded-chip px-1.5 py-1 text-left transition-colors duration-100",
              index === activeIndex ? "bg-flow-tint text-flow" : "text-secondary hover:bg-raised",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow",
            )}
          >
            <span className="shrink-0 font-machine text-hud-micro">{shortTaskId(task.id)}</span>
            <span className="min-w-0 flex-1 truncate text-hud-body">{task.title}</span>
            <span className="shrink-0 font-machine text-hud-micro tabular-nums text-muted">
              {formatPriority(task.priority)}
            </span>
          </button>
          <p className="px-1.5 font-machine text-hud-micro text-disabled">
            {task.project_slug} · {formatRelativeTime(task.updated_at)}
          </p>
        </li>
      ))}
    </ul>
  );
}
