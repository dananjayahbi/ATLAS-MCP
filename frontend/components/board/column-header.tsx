"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/format/cn";
import { Kbd } from "@/components/ui/kbd";

/** Doc 06 §8.4 — column header with count, collapse toggle and optional accent. */

export type ColumnHeaderProps = {
  label: string;
  count: number;
  glyph?: ReactNode;
  accentVar?: string;
  actionHint?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
};

export function ColumnHeader({
  label,
  count,
  glyph,
  accentVar,
  actionHint,
  collapsed,
  onToggle,
  className,
}: ColumnHeaderProps) {
  const content = (
    <>
      {glyph ? (
        <span aria-hidden className="shrink-0" style={accentVar ? { color: accentVar } : undefined}>
          {glyph}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-hud-micro uppercase tracking-[0.08em] text-secondary">{label}</span>
      <span className="shrink-0 rounded-chip border border-grid px-1 font-machine text-hud-micro tabular-nums text-muted">
        {count}
      </span>
      {actionHint ? <Kbd size="xs">{actionHint}</Kbd> : null}
      {onToggle ? (
        <span aria-hidden className="shrink-0 text-disabled">
          {collapsed ? "▸" : "▾"}
        </span>
      ) : null}
    </>
  );

  const base = cn("flex h-7 w-full items-center gap-1.5 border-b border-grid px-1.5", className);

  if (!onToggle) return <div className={base}>{content}</div>;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={cn(base, "hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow")}
    >
      {content}
    </button>
  );
}
