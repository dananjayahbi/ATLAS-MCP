"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/format/cn";
import { usePriorityMatrix, useReviews, useTasks, useTelemetry } from "@/lib/api/queries";
import type { MatrixXAxis } from "@/lib/api/telemetry";
import type { TaskSummaryDTO } from "@/lib/types/api";
import { PageShell } from "@/components/hud/hud-frame";
import { TelemetryStrip } from "@/components/hud/telemetry-strip";
import { PriorityMatrix } from "@/components/matrix/priority-matrix";
import { TaskCard } from "@/components/board/task-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

/** Doc 06 §5.1 — the telemetry band: radar + queue stats + review queue preview. */

export type CommandCenterProps = {
  className?: string;
};

function QueueStats({ tasks }: { tasks: readonly TaskSummaryDTO[] }) {
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
  const [xAxis, setXAxis] = useState<MatrixXAxis>("age_hours");
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const matrix = usePriorityMatrix(xAxis);
  const board = useTasks("alpha", {}, { kind: "board" });

  const tasks = board.data?.items ?? [];
  const reviewItems = reviews.data?.items ?? [];

  return (
    <PageShell
      title="Command Center"
      subtitle="Multi-agent orchestration · telemetry, priority matrix and review queue"
      actions={
        <>
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

        <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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
            <Panel panelId="queue" title="Queue stats" meta={board.isFetching ? "syncing" : "live"}>
              {board.isLoading && !board.data ? <Skeleton lines={3} /> : <QueueStats tasks={tasks} />}
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
    </PageShell>
  );
}
