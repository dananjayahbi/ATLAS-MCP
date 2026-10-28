"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/format/cn";
import { formatAgeHours } from "@/lib/format/duration";
import { formatPriority } from "@/lib/format/priority";
import { useArchiveTask, useArchivedProjects, useArchivedTasks, useProjects } from "@/lib/api/queries";
import { errorMessage } from "@/lib/api/errors";
import { toast } from "@/hooks/use-toast";
import type { ProjectDTO, TaskSummaryDTO } from "@/lib/types/api";
import { PriorityChip, StatusBadge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DeleteTaskDialog } from "@/components/tasks/delete-task-dialog";

/**
 * Archived tasks for one project.
 *
 * The archive is a separate read (`?archived=1`), not a status sweep: a task the
 * reviewer rejected is live work the operator can requeue, while a task the
 * operator archived has `archived_at` set and belongs here. Restore returns it
 * to PENDING (T13); delete is offered because an archived mistake should not be
 * permanent clutter.
 */

export type ArchivedTaskListProps = {
  slug: string;
  projectName?: string;
  className?: string;
};

export function ArchivedTaskList({ slug, projectName, className }: ArchivedTaskListProps) {
  const tasks = useArchivedTasks(slug);
  const restore = useArchiveTask();
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = tasks.data?.items ?? [];

  const doRestore = async (task: TaskSummaryDTO) => {
    setError(null);
    try {
      await restore.mutateAsync({ id: task.id, archived: false });
      toast({ level: "info", title: `Task restored: ${task.title}` });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (tasks.isLoading && rows.length === 0) return <Skeleton lines={3} />;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}

      {rows.length === 0 ? (
        <EmptyState
          inline
          title="No archived tasks"
          hint={
            projectName
              ? `Nothing archived in ${projectName}. Archiving a task files it here without deleting it.`
              : "Archiving a task files it here without deleting it."
          }
        />
      ) : (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {rows.map((task) => (
            <li
              key={task.id}
              className="flex min-w-0 flex-col gap-1 rounded-hud border border-grid bg-panel/70 p-2"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <PriorityChip priority={task.priority} />
                <StatusBadge status={task.status} />
                <span className="shrink-0 font-machine text-hud-micro text-disabled">ARCHIVED</span>
                <span className="min-w-0 flex-1" />
                <span className="shrink-0 font-machine text-hud-micro tabular-nums text-disabled">
                  {task.archived_at ? new Date(task.archived_at).toLocaleDateString() : ""}
                </span>
              </div>

              <Link
                href={`/projects/${task.project_slug}/tasks/${task.id}`}
                className="min-w-0 truncate text-hud-body text-primary hover:text-flow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
                title={task.title}
              >
                {task.title}
              </Link>

              <div className="flex min-w-0 flex-wrap items-center gap-1 font-machine text-hud-micro text-muted">
                <span className="tabular-nums">{formatAgeHours(task.age_hours)} old</span>
                <span aria-hidden className="text-disabled">·</span>
                <span className="tabular-nums">{task.dod_progress_percent}% DoD</span>
                <span aria-hidden className="text-disabled">·</span>
                <span className="tabular-nums">{formatPriority(task.priority)}</span>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void doRestore(task)}
                  loading={restore.isPending && restore.variables?.id === task.id}
                >
                  Restore
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting({ id: task.id, title: task.title })}>
                  Delete…
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <DeleteTaskDialog
        open={deleting !== null}
        taskId={deleting?.id ?? ""}
        taskTitle={deleting?.title ?? "task"}
        onClose={() => setDeleting(null)}
        onDeleted={() => void tasks.refetch()}
        onArchive={
          deleting
            ? () => {
                setDeleting(null);
                void tasks.refetch();
              }
            : undefined
        }
      />
    </div>
  );
}

/**
 * Every project's archive in one list, for the cross-project archive view.
 *
 * Active and archived projects are both read: an archived project's tasks are
 * still archives of *something*, and hiding them would make work appear lost.
 */
export function ArchivedTaskSections({ className }: { className?: string }) {
  const active = useProjects();
  const archived = useArchivedProjects();
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const merged: ProjectDTO[] = [];
    for (const project of [...(archived.data?.items ?? []), ...(active.data?.items ?? [])]) {
      if (seen.has(project.slug)) continue;
      seen.add(project.slug);
      merged.push(project);
    }
    return merged;
  }, [active.data, archived.data]);

  if ((active.isLoading || archived.isLoading) && rows.length === 0) return <Skeleton lines={4} />;
  if (rows.length === 0) {
    return <EmptyState inline title="No projects" hint="Create a project to start archiving work." />;
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {rows.map((project) => (
        <section key={project.slug} aria-label={`Archived tasks in ${project.name}`} className="flex min-w-0 flex-col gap-1">
          <h3 className="flex items-baseline gap-1 text-hud-micro uppercase tracking-[0.08em] text-muted">
            <span className="min-w-0 truncate">{project.name}</span>
            {project.archived_at !== null ? (
              <span className="shrink-0 text-disabled">· project archived</span>
            ) : null}
          </h3>
          <ArchivedTaskList slug={project.slug} projectName={project.name} />
        </section>
      ))}
    </div>
  );
}
