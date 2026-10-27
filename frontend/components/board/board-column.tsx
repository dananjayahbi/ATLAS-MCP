"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/format/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { ColumnHeader } from "./column-header";

/**
 * Doc 06 §8.4 — one board column. Independently scrollable; `content-visibility`
 * keeps off-screen cards cheap (§15.3).
 */

export type BoardColumnProps = {
  id: string;
  label: string;
  count: number;
  glyph?: ReactNode;
  accentVar?: string;
  actionHint?: string;
  emptyText?: string;
  collapsedByDefault?: boolean;
  onOpenFirst?: () => void;
  /** Drop target for status drags; omitted for the priority grouping. */
  onDropTask?: (taskId: string) => void;
  /** True when this column is a legal destination for the drag in flight. */
  dropTarget?: boolean;
  children: ReactNode;
  className?: string;
};

export function BoardColumn({
  id,
  label,
  count,
  glyph,
  accentVar,
  actionHint,
  emptyText = "Nothing here",
  collapsedByDefault = false,
  onDropTask,
  dropTarget = false,
  children,
  className,
}: BoardColumnProps) {
  const [collapsed, setCollapsed] = useState(collapsedByDefault);
  const [over, setOver] = useState(false);
  // A priority-grouped column has no status semantics, so it must not react to
  // a status drag even if a handler leaks in from the parent.
  const droppable = Boolean(onDropTask);

  return (
    <section
      aria-label={`${label} — ${count}`}
      data-column={id}
      data-drop-target={droppable ? "true" : undefined}
      style={{ contentVisibility: "auto" }}
      onDragOver={(event) => {
        if (!droppable) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!droppable) return;
        event.preventDefault();
        setOver(false);
        const taskId = event.dataTransfer.getData("text/atlas-task") || event.dataTransfer.getData("text/plain");
        if (taskId) onDropTask?.(taskId);
      }}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-hud border border-grid bg-panel/60 transition-colors duration-100",
        dropTarget && "border-flow/40",
        over && "border-flow bg-flow-tint/30",
        className,
      )}
    >
      <ColumnHeader
        label={label}
        count={count}
        glyph={glyph}
        accentVar={accentVar}
        actionHint={actionHint}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
      {collapsed ? null : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {count === 0 ? <EmptyState inline title={emptyText} /> : <div className="flex flex-col gap-1.5">{children}</div>}
        </div>
      )}
    </section>
  );
}
