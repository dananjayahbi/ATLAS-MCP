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
  children,
  className,
}: BoardColumnProps) {
  const [collapsed, setCollapsed] = useState(collapsedByDefault);

  return (
    <section
      aria-label={`${label} — ${count}`}
      data-column={id}
      style={{ contentVisibility: "auto" }}
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-hud border border-grid bg-panel/60", className)}
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
