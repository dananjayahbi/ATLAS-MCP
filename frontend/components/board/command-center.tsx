"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/format/cn";
import { usePriorityMatrix, useProjects, useReviews, useTasks, useTelemetry } from "@/lib/api/queries";
import type { MatrixXAxis } from "@/lib/api/telemetry";
import type { TaskSummaryDTO } from "@/lib/types/api";
import { PageShell } from "@/components/hud/hud-frame";
import { TelemetryStrip } from "@/components/hud/telemetry-strip";
import { PriorityMatrix } from "@/components/matrix/priority-matrix";
import { GlobalAgentActivityStream } from "@/components/board/global-agent-activity-stream";
import { TaskCard } from "@/components/board/task-card";
import { WorkspaceRail } from "@/components/board/workspace-rail";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

/** Doc 06 §5.1 — the telemetry band: radar + queue stats + review queue preview. */

export type CommandCenterProps = {
  className?: string;
};

function QueueStats({ tasks, loading }: { tasks: readonly TaskSummaryDTO[]; loading: boolean }) {
  const rows = useMemo(() => {
    const pending = tasks.filter((task) => task.status === "PENDING");
    const blocked = tasks.filter((task) => task.is_blocked);
    const discovered = tasks.filter((task) => task.is_agent_discovered);
    return [
      { label: "PENDING", value: pending.length, tone: "text-secondary" },
      { label: "BLOCKED", value: blocked.length, tone: blocked.length ? "text-review-hot" : "text-secondary" },
      { label: "DISCOVERED", value: discovered.length, tone: discovered.length ? "text-review-hot" : "text-secondary" },
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
  const [xAxis, setXAxis] = useState<MatrixXAxis>("age_hours");
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const matrix = usePriorityMatrix(xAxis);

  const projects = projectsQuery.data?.items ?? [];
  // The command center must never pin a hardcoded slug: the queue preview follows
  // the first non-archived project, which is also what the telemetry strip shows.
  const primary = projects.find((project) => project.archived_at === null)?.slug ?? projects[0]?.slug ?? "";
  const board = useTasks(primary, {}, { kind: "board" });

  const tasks = board.data?.items ?? [];
  const reviewItems = reviews.data?.items ?? [];

  return (
    <PageShell
      title="Command Center"
      subtitle="Multi-agent orchestration · telemetry, priority matrix and review queue"
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

        <div className="grid min-h-0 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <WorkspaceRail
            projects={projects}
            loading={projectsQuery.isLoading}
            onCreateProject={() => setCreateOpen(true)}
          />

          <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel
              panelId="matrix"
              title="Priority matrix"
              meta={`${matrix.data?.points.length ?? 0} points`}
              scanline
              state={matrix.isLoading && !matrix.data ? "loading" : "idle"}
              bodyClassName="pt-2"
            >
              <PriorityMatrix
                data={matrix.data}
                loading={matrix.isFetching}
                xAxis={xAxis}
                onXAxisChange={setXAxis}
                selection={selection}
                onSelectionChange={setSelection}
                height={300}
              />
            </Panel>

            <div className="flex min-h-0 flex-col gap-3">
              <Panel panelId="queue" title="Queue stats" meta={board.isFetching ? "syncing" : primary || "—"}>
                <QueueStats tasks={tasks} loading={board.isLoading} />
              </Panel>

              <GlobalAgentActivityStream limit={8} className="min-h-0" />

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
                        <TaskCard
                          task={task}
                          compact
                          href={`/projects/${task.project_slug}/tasks/${task.id}`}
                        />
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
    </PageShell>
  );
}
