"use client";

import { cn } from "@/lib/format/cn";
import { formatRelativeTime } from "@/lib/format/duration";
import type { ChecklistItemDTO } from "@/lib/types/enums";

/**
 * Doc 06 §7.2 / §10.4 — DoD checklist. Read-only in a work pane (the agent owns
 * DoD); tickable in the review gate, which is the one place a human may tick.
 */

export type DodListProps = {
  items: ChecklistItemDTO[];
  onToggle?: (itemId: number, completed: boolean) => void;
  pendingItemId?: number | null;
  disabled?: boolean;
  className?: string;
};

export function DodList({ items, onToggle, pendingItemId = null, disabled = false, className }: DodListProps) {
  const interactive = typeof onToggle === "function";

  if (items.length === 0) {
    return <p className={cn("text-hud-body text-muted", className)}>No definition of done recorded.</p>;
  }

  return (
    <ul className={cn("flex flex-col gap-0.5", className)} aria-label="Definition of done">
      {items.map((item) => {
        const busy = pendingItemId === item.id;
        return (
          <li key={item.id} className="flex items-start gap-2 rounded-chip px-1 py-0.5 hover:bg-raised/40">
            <input
              type="checkbox"
              id={`dod-${item.id}`}
              checked={item.completed}
              disabled={!interactive || disabled || busy}
              onChange={(event) => onToggle?.(item.id, event.target.checked)}
              className={cn(
                "mt-0.5 size-3 shrink-0 accent-[var(--color-flow)]",
                !interactive && "cursor-default opacity-70",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow",
              )}
            />
            <label
              htmlFor={`dod-${item.id}`}
              className={cn(
                "min-w-0 flex-1 text-hud-body",
                item.completed ? "text-muted line-through decoration-grid" : "text-secondary",
                interactive && !disabled && "cursor-pointer",
              )}
            >
              {item.label}
            </label>
            {item.completed_at ? (
              <time
                dateTime={item.completed_at}
                className="shrink-0 font-machine text-hud-micro tabular-nums text-disabled"
                title={item.completed_at}
              >
                {formatRelativeTime(item.completed_at)}
              </time>
            ) : (
              <span className="shrink-0 font-machine text-hud-micro text-disabled">{busy ? "…" : "—"}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
