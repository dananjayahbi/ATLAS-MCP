"use client";

import { useEffect, useRef, type RefObject } from "react";
import { cn } from "@/lib/format/cn";
import { STATUS_META, TASK_STATUS_ORDER } from "@/lib/format/tone";
import type { TaskStatus } from "@/lib/types/enums";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/**
 * Doc 06 §8.3 — the board filter bar. Search is debounced by the parent; this
 * component is fully controlled so URL state stays authoritative.
 */

export type TaskFilterBarProps = {
  q: string;
  onQueryChange: (value: string) => void;
  statuses: readonly TaskStatus[];
  onStatusesChange: (value: TaskStatus[]) => void;
  agents: readonly string[];
  agent: string | null;
  onAgentChange: (value: string | null) => void;
  blockedOnly: boolean;
  onBlockedOnlyChange: (value: boolean) => void;
  priorityMin: number | null;
  onPriorityMinChange: (value: number | null) => void;
  sort: string;
  onSortChange: (value: string) => void;
  total: number;
  shown: number;
  onReset: () => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  className?: string;
};

const SORTS = [
  { value: "priority", label: "Priority" },
  { value: "created", label: "Newest" },
  { value: "updated", label: "Updated" },
] as const;

export function TaskFilterBar({
  q,
  onQueryChange,
  statuses,
  onStatusesChange,
  agents,
  agent,
  onAgentChange,
  blockedOnly,
  onBlockedOnlyChange,
  priorityMin,
  onPriorityMinChange,
  sort,
  onSortChange,
  total,
  shown,
  onReset,
  searchRef,
  className,
}: TaskFilterBarProps) {
  const local = useRef<HTMLInputElement>(null);
  const inputRef = searchRef ?? local;
  const filtered =
    q.length > 0 ||
    statuses.length > 0 ||
    agent !== null ||
    blockedOnly ||
    priorityMin !== null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inputRef]);

  const toggleStatus = (status: TaskStatus) => {
    onStatusesChange(
      statuses.includes(status) ? statuses.filter((value) => value !== status) : [...statuses, status],
    );
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="relative flex min-w-[12rem] flex-1 items-center">
          <span aria-hidden className="pointer-events-none absolute left-1.5 text-hud-micro text-disabled">
            ⌕
          </span>
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onQueryChange("");
                event.currentTarget.blur();
              }
            }}
            aria-label="Search tasks"
            placeholder="Search title or description…"
            className="h-6 w-full rounded-chip border border-grid bg-canvas pl-6 pr-8 font-machine text-machine-sm text-primary placeholder:text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          />
          {q.length === 0 ? (
            <span className="pointer-events-none absolute right-1.5 text-hud-micro">
              <Kbd size="xs">/</Kbd>
            </span>
          ) : (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange("")}
              className="absolute right-1 grid size-4 place-items-center rounded-chip text-hud-micro text-muted hover:text-primary"
            >
              ✕
            </button>
          )}
        </div>

        <label className="inline-flex shrink-0 items-center gap-1 font-machine text-hud-micro uppercase text-muted">
          sort
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
            aria-label="Sort tasks"
            className="h-6 cursor-pointer rounded-chip border border-grid bg-canvas px-1 font-machine text-hud-micro text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {agents.length > 0 ? (
          <select
            value={agent ?? ""}
            onChange={(event) => onAgentChange(event.target.value || null)}
            aria-label="Filter by agent"
            className="h-6 max-w-40 cursor-pointer rounded-chip border border-grid bg-canvas px-1 font-machine text-hud-micro text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          >
            <option value="">all agents</option>
            {agents.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}

        <label
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 font-machine text-hud-micro uppercase text-muted"
          title="Tasks whose blocker has not yet reached 100% Definition of Done"
        >
          <input
            type="checkbox"
            checked={blockedOnly}
            onChange={(event) => onBlockedOnlyChange(event.target.checked)}
            className="size-3 accent-[var(--color-flow)]"
          />
          blocked
        </label>

        <label className="inline-flex shrink-0 items-center gap-1 font-machine text-hud-micro uppercase text-muted">
          P≥
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={priorityMin ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              onPriorityMinChange(next === "" ? null : Number(next));
            }}
            aria-label="Minimum priority"
            className="h-6 w-14 rounded-chip border border-grid bg-canvas px-1 font-machine text-hud-micro tabular-nums text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          />
        </label>

        <span className="min-w-0 flex-1" />

        <span className="shrink-0 font-machine text-hud-micro tabular-nums text-muted">
          {shown === total ? `${total} tasks` : `${shown}/${total}`}
        </span>
        {filtered ? (
          <Button size="sm" variant="ghost" onClick={onReset}>
            Clear
          </Button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
        {TASK_STATUS_ORDER.map((status) => {
          const active = statuses.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => toggleStatus(status)}
              className={cn(
                "rounded-chip border px-1.5 font-machine text-hud-micro uppercase tracking-[0.06em] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow",
                active
                  ? "border-flow/50 bg-flow-tint text-flow"
                  : "border-grid text-muted hover:border-grid-strong hover:text-primary",
              )}
            >
              <span aria-hidden style={{ color: STATUS_META[status].cssVar }}>
                {STATUS_META[status].glyph}
              </span>{" "}
              {STATUS_META[status].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
