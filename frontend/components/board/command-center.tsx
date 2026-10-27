"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useProjects, useReviews, useTelemetry } from "@/lib/api/queries";
import { cn } from "@/lib/format/cn";
import { useGlobalTaskQueue } from "@/hooks/use-global-task-queue";
import type { TaskSummaryDTO } from "@/lib/types/api";
import { PageShell } from "@/components/hud/hud-frame";
import { TelemetryStrip } from "@/components/hud/telemetry-strip";
import { GlobalAgentActivityStream } from "@/components/board/global-agent-activity-stream";
import { PendingQueue, RecentProjectCard } from "@/components/board/pending-queue";
import { TaskCard } from "@/components/board/task-card";
import { WorkspaceRail } from "@/components/board/workspace-rail";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { EditProjectDialog } from "@/components/projects/edit-project-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Doc 06 §5.1 — the command center.
 *
 * The telemetry band, the cross-project pending queue, the recent-activity
 * strip, and the review/activity columns. The priority scatter that used to
 * live here is gone: a ranked queue answers "what is waiting?" without needing
 * a legend, and it is actionable.
 */

export type CommandCenterProps = {
  className?: string;
};

const RECENT_LIMIT = 3;

/** Most recently active first: `last_event_at`, falling back to `updated_at`. */
function lastActivity(iso: string | null | undefined): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function QueueStats({ tasks, loading }: { tasks: readonly TaskSummaryDTO[]; loading: boolean }) {
  const rows = useMemo(() => {
    const pending = tasks.filter((task) => task.status === "PENDING");
    const blocked = tasks.filter((task) => task.is_blocked);
    const discovered = tasks.filter((task) => task.is_agent_discovered);
    return [
      { label: "PENDING", value: pending.length, tone: "text-secondary" },
      { label: "BLOCKED", value: blocked.length, tone: blocked.length ? "text-review-hot" : "text-secondary" },
      {
        label: "DISCOVERED",
        value: discovered.length,
        tone: discovered.length ? "text-review-hot" : "text-secondary",
      },
    ];
  }, [tasks]);

  if (loading && tasks.length === 0) return <Skeleton lines={3} />;

  return (
    <dl className="grid grid-cols-3 gap-1">
      {rows.map((row) => (
        <div key={row.label} className="rounded-hud border border-grid bg-inset/60 px-2 py-1">
          <dt className="text-hud-micro uppercase tracking-[0.08em] text-disabled">{row.label}</dt>
          <dd className={cn("font-machine text-hud-title tabular-nums", row.tone)}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CommandCenterOverview({ className }: CommandCenterProps) {
  const telemetry = useTelemetry();
  const reviews = useReviews();
  const projectsQuery = useProjects();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsSlug, setSettingsSlug] = useState<string | null>(null);

  const projects = projectsQuery.data?.items ?? [];
  const activeProjects = useMemo(
    () => projects.filter((project) => project.archived_at === null),
    [projects],
  );
  const slugs = useMemo(() => activeProjects.map((project) => project.slug), [activeProjects]);

  // The queue is PENDING across every workspace: exactly what an agent will
  // claim next, which is why it belongs on the command center.
  const queue = useGlobalTaskQueue(slugs, { statuses: ["PENDING"], limitPerProject: 50 });
  const all = useGlobalTaskQueue(slugs, { limitPerProject: 50 });

  const recent = useMemo(
    () =>
      [...activeProjects]
        .sort(
          (a, b) =>
            lastActivity(b.last_event_at ?? b.updated_at) - lastActivity(a.last_event_at ?? a.updated_at),
        )
        .slice(0, RECENT_LIMIT),
    [activeProjects],
  );

  const reviewItems = reviews.data?.items ?? [];
  const settingsProject = projects.find((project) => project.slug === settingsSlug) ?? null;

  return (
    <PageShell
      title="Command Center"
      subtitle="Multi-agent orchestration · queue, telemetry and review gate"
      actions={
        <>
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
            New project
          </Button>
          <Button size="sm" onClick={() => reviews.refetch()}>
            Refresh
          </Button>
          <Link
            href="/reviews"
            className="rounded-hud border border-grid px-2 py-1 text-hud-micro uppercase tracking-[0.06em] text-secondary hover:border-grid-strong hover:text-primary"
          >
            Review gate
          </Link>
        </>
      }
      className={className}
    >
      <div className="flex min-h-0 flex-col gap-3">
        <TelemetryStrip telemetry={telemetry.data} />

        {/* Most recently active workspaces, directly under the header band. */}
        <section aria-label="Recent workspaces" className="flex shrink-0 flex-col gap-1">
          <div className="flex items-baseline justify-between px-0.5">
            <h2 className="text-hud-micro uppercase tracking-[0.08em] text-muted">Recent activity</h2>
            <span className="font-machine text-hud-micro uppercase text-disabled">
              last {Math.min(RECENT_LIMIT, activeProjects.length)} of {activeProjects.length}
            </span>
          </div>
          {projectsQuery.isLoading && activeProjects.length === 0 ? (
            <Skeleton lines={2} />
          ) : recent.length === 0 ? (
            <EmptyState
              inline
              title="No workspaces yet"
              hint="Create a project to start orchestrating."
              action={
                <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
                  New project
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((project) => (
                <li key={project.slug}>
                  <RecentProjectCard project={project} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid min-h-0 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <WorkspaceRail
            projects={projects}
            loading={projectsQuery.isLoading}
            onCreateProject={() => setCreateOpen(true)}
            onEditProject={(project) => setSettingsSlug(project.slug)}
          />

          <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col gap-3">
              <Panel
                panelId="pending-queue"
                title="Pending queue"
                meta={`${queue.tasks.length} across ${slugs.length} project${slugs.length === 1 ? "" : "s"}`}
                scanline
                state={queue.isLoading && queue.tasks.length === 0 ? "loading" : "idle"}
                bodyClassName="pt-1"
              >
                <PendingQueue tasks={queue.tasks} projects={projects} loading={queue.isLoading} limit={12} />
              </Panel>

              <GlobalAgentActivityStream limit={10} className="min-h-0" />
            </div>

            <div className="flex min-h-0 flex-col gap-3">
              <Panel
                panelId="queue"
                title="Queue stats"
                meta={queue.isFetching ? "syncing" : `${all.tasks.length} live`}
              >
                <QueueStats tasks={all.tasks} loading={all.isLoading} />
              </Panel>

              <Panel
                panelId="reviews"
                title="Review queue"
                meta={`${reviewItems.length} awaiting`}
                state={reviews.isLoading && !reviews.data ? "loading" : "idle"}
              >
                {reviewItems.length === 0 ? (
                  <EmptyState inline title="Nothing awaiting sign-off" hint="Submitted work appears here." />
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {reviewItems.slice(0, 5).map((task) => (
                      <li key={task.id}>
                        <TaskCard task={task} compact href={`/projects/${task.project_slug}/tasks/${task.id}`} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </div>
      </div>

      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {settingsProject ? (
        <EditProjectDialog
          open
          project={settingsProject}
          onClose={() => setSettingsSlug(null)}
          onSaved={() => setSettingsSlug(null)}
        />
      ) : null}
    </PageShell>
  );
}
