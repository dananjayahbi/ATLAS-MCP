"use client";

import Link from "next/link";
import { cn } from "@/lib/format/cn";
import { formatAgeHours } from "@/lib/format/duration";
import { healthTone, HEALTH_CLASS, STATUS_META } from "@/lib/format/tone";
import type { ProjectDTO, TaskSummaryDTO } from "@/lib/types/api";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityChip } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The command center's pending queue across every project.
 *
 * Replaces the priority scatter (the operator's verdict: "ugly"). A queue is
 * what the page is actually for — what is waiting, how old, and which workspace
 * it belongs to — so it renders as a dense ranked list instead of a chart that
 * needed a legend to be readable.
 */

export type PendingQueueProps = {
  tasks: readonly TaskSummaryDTO[];
  projects: readonly ProjectDTO[];
  loading?: boolean;
  /** Rows beyond this collapse into a "+n more" line. */
  limit?: number;
  className?: string;
};

export function PendingQueue({ tasks, projects, loading = false, limit = 12, className }: PendingQueueProps) {
  const accentBySlug = new Map(projects.map((project) => [project.slug, project.accent_color]));
  const nameBySlug = new Map(projects.map((project) => [project.slug, project.name]));

  if (loading && tasks.length === 0) return <Skeleton lines={6} />;

  if (tasks.length === 0) {
    return (
      <EmptyState
        inline
        title="Queue is clear"
        hint="No pending tasks across any project. Agents have nothing to claim."
      />
    );
  }

  const visible = tasks.slice(0, limit);
  const hidden = tasks.length - visible.length;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <ol className="flex min-h-0 flex-col divide-y divide-grid" aria-label="Pending tasks across all projects">
        {visible.map((task, index) => (
          <li key={task.id}>
            <Link
              href={`/projects/${task.project_slug}/tasks/${task.id}`}
              className="group flex min-w-0 items-center gap-2 px-1 py-1.5 transition-colors duration-100 hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
            >
              <span
                className="w-5 shrink-0 text-right font-machine text-hud-micro tabular-nums text-disabled"
                aria-hidden
              >
                {index + 1}
              </span>

              <span
                aria-hidden
                className="h-6 w-0.5 shrink-0 rounded-full"
                style={{ background: accentBySlug.get(task.project_slug) ?? "var(--border-grid)" }}
              />

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="min-w-0 truncate text-hud-body text-primary group-hover:text-flow" title={task.title}>
                  {task.title}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 font-machine text-hud-micro text-muted">
                  <span className="min-w-0 truncate" style={{ color: accentBySlug.get(task.project_slug) }}>
                    {nameBySlug.get(task.project_slug) ?? task.project_slug}
                  </span>
                  <span aria-hidden className="text-disabled">
                    ·
                  </span>
                  <span className="shrink-0 tabular-nums">{formatAgeHours(task.age_hours)}</span>
                  {task.is_blocked ? (
                    <>
                      <span aria-hidden className="text-disabled">
                        ·
                      </span>
                      <span className="shrink-0 text-review-hot">blocked</span>
                    </>
                  ) : null}
                  {task.is_agent_discovered ? (
                    <>
                      <span aria-hidden className="text-disabled">
                        ·
                      </span>
                      <span className="shrink-0 text-review-hot" title="Discovered by an agent">
                        ⚡
                      </span>
                    </>
                  ) : null}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-1">
                {task.dod_progress_percent > 0 ? (
                  <span className="hidden font-machine text-hud-micro tabular-nums text-muted sm:inline">
                    {task.dod_progress_percent}%
                  </span>
                ) : null}
                <Badge tone="neutral" className="hidden md:inline-flex">
                  {STATUS_META[task.status].label}
                </Badge>
                <PriorityChip priority={task.priority} />
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {hidden > 0 ? (
        <p className="border-t border-grid px-1 py-1 font-machine text-hud-micro uppercase tracking-[0.06em] text-disabled">
          +{hidden} more pending · open a workspace to see the rest
        </p>
      ) : null}
    </div>
  );
}

/** Compact project health row used by the "recent activity" strip. */
export function RecentProjectCard({ project }: { project: ProjectDTO }) {
  const total =
    project.counters.pending +
    project.counters.in_progress +
    project.counters.in_review +
    project.counters.completed;
  const done = project.counters.completed;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group flex min-w-0 flex-col gap-1 rounded-hud border border-grid bg-panel/70 p-2 transition-colors duration-100 hover:border-flow/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: project.accent_color }} />
        <span className="min-w-0 flex-1 truncate font-machine text-machine-sm uppercase tracking-[0.06em] text-primary group-hover:text-flow">
          {project.name}
        </span>
        <span
          className={cn(
            "shrink-0 font-machine text-hud-micro tabular-nums",
            HEALTH_CLASS[healthTone(project.counters.health_percent)],
          )}
          title="Health = completed / (completed + pending + in progress + in review)"
        >
          {project.counters.health_percent}%
        </span>
      </span>

      {/* Progress bar: completed share of every live task in the workspace. */}
      <span
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${project.name} completion`}
        className="h-1 overflow-hidden rounded-full bg-inset"
      >
        <span
          className="block h-full rounded-full transition-[width] duration-300"
          style={{ width: `${percent}%`, background: project.accent_color }}
        />
      </span>

      <span className="flex min-w-0 items-center gap-1.5 font-machine text-hud-micro text-muted">
        <span className="tabular-nums">{project.counters.pending} pending</span>
        {project.counters.in_progress > 0 ? (
          <span className="tabular-nums text-flow">{project.counters.in_progress} running</span>
        ) : null}
        {project.counters.in_review > 0 ? (
          <span className="tabular-nums text-review-hot">{project.counters.in_review} review</span>
        ) : null}
      </span>
    </Link>
  );
}
