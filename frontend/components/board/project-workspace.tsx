"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePriorityMatrix, useProject, useProjects, useTasks, useTelemetry } from "@/lib/api/queries";
import type { MatrixXAxis } from "@/lib/api/telemetry";
import { useUrlState } from "@/hooks/use-url-state";
import type { TaskSummaryDTO } from "@/lib/types/api";
import { PageShell } from "@/components/hud/hud-frame";
import { TelemetryStrip } from "@/components/hud/telemetry-strip";
import { SplitAgentWorkbench } from "@/components/board/split-agent-workbench";
import { TaskBoardView, type BoardGrouping } from "@/components/board/board-view";
import { TaskCard } from "@/components/board/task-card";
import { WorkspaceRail } from "@/components/board/workspace-rail";
import { PriorityMatrix } from "@/components/matrix/priority-matrix";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import { Kbd } from "@/components/ui/kbd";

/** Doc 06 §5/§7 — split multi-agent board workspace for one project. */

export type ProjectWorkspaceProps = {
  slug: string;
  className?: string;
};

type View = "board" | "list" | "matrix";

export function ProjectWorkspace({ slug, className }: ProjectWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = useProject(slug);
  const projectsQuery = useProjects();
  const telemetry = useTelemetry();
  const { params, setLayout, assign } = useUrlState();

  const [group, setGroup] = useState<BoardGrouping>("status");
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [matrixAxis, setMatrixAxis] = useState<MatrixXAxis>("age_hours");

  const view = (searchParams.get("view") ?? "board") as View;
  const tasksQuery = useTasks(slug, {}, { kind: "board" });
  const matrix = usePriorityMatrix(matrixAxis);

  const ordered = useMemo(
    () => [...(tasksQuery.data?.items ?? [])].sort((a, b) => b.priority - a.priority || b.age_hours - a.age_hours),
    [tasksQuery.data],
  );

  const openTask = (task: TaskSummaryDTO) => router.push(`/projects/${slug}/tasks/${task.id}`);

  const toggleSelection = (id: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setView = (next: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("view", next);
    router.replace(`/projects/${slug}?${nextParams.toString()}`, { scroll: false });
  };

  return (
    <PageShell
      title={project.data?.name ?? slug}
      subtitle={`${slug} · ${ordered.length} tasks · ${params.layout}`}
      actions={
        <Tabs
          items={[
            { id: "board", label: "Board" },
            { id: "list", label: "List" },
            { id: "matrix", label: "Matrix" },
          ]}
          value={view}
          onChange={setView}
        />
      }
      className={className}
    >
      <div className="flex min-h-0 flex-col gap-3">
        <TelemetryStrip telemetry={telemetry.data} />

        <div className="grid min-h-0 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <WorkspaceRail projects={projectsQuery.data?.items ?? []} loading={projectsQuery.isLoading} />

          <div className="flex min-h-0 flex-col gap-3">
            {project.isError ? (
              <p role="alert" className="text-hud-body text-critical-hot">
                Project {slug} could not be loaded.
                <Button size="sm" className="ml-2" onClick={() => project.refetch()}>
                  Retry
                </Button>
              </p>
            ) : null}

            {view === "matrix" ? (
              <Panel panelId="project-matrix" title="Priority matrix" meta={`${matrix.data?.points.length ?? 0} pts`} scanline>
                <PriorityMatrix
                  data={matrix.data}
                  loading={matrix.isFetching}
                  xAxis={matrixAxis}
                  onXAxisChange={setMatrixAxis}
                  selection={selection}
                  onSelectionChange={setSelection}
                  onOpenTask={(id) => router.push(`/projects/${slug}/tasks/${id}`)}
                  height={280}
                />
              </Panel>
            ) : view === "list" ? (
              <Panel
                panelId="task-list"
                title="Tasks"
                meta={`${ordered.length} rows`}
                state={tasksQuery.isLoading && !tasksQuery.data ? "loading" : "idle"}
              >
                {ordered.length === 0 ? (
                  <EmptyState inline title="No tasks" hint="Create a task or clear the filters." />
                ) : (
                  <ul role="list" className="flex flex-col gap-1">
                    {ordered.map((task) => (
                      <li key={task.id}>
                        <TaskCard
                          task={task}
                          selected={selection.has(task.id)}
                          onSelect={toggleSelection}
                          onOpen={() => openTask(task)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ) : (
              <Panel
                panelId="task-board"
                title="Board"
                meta={tasksQuery.isFetching ? "syncing" : `${ordered.length} tasks`}
                state={tasksQuery.isLoading && !tasksQuery.data ? "loading" : "idle"}
                bodyClassName="pt-2"
              >
                <TaskBoardView
                  tasks={ordered}
                  group={group}
                  onGroupChange={setGroup}
                  selectedIds={selection}
                  onSelect={toggleSelection}
                  onOpen={(id) => {
                    const task = ordered.find((row) => row.id === id);
                    if (task) openTask(task);
                  }}
                />
              </Panel>
            )}

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <h2 className="text-hud-micro uppercase tracking-[0.08em] text-muted">Split workbench</h2>
              <span className="inline-flex items-center gap-1 text-hud-micro text-disabled">
                <Kbd>Shift</Kbd>+<Kbd>1…4</Kbd> focus slot
              </span>
              <span className="min-w-0 flex-1" />
              <Button
                size="sm"
                onClick={() => assign(0, slug, ordered[0]?.id ?? null)}
                disabled={ordered.length === 0}
                title="Assign the top-priority task to slot 1"
              >
                Pin top task
              </Button>
            </div>

            <SplitAgentWorkbench
              layout={params.layout}
              onLayoutChange={setLayout}
              projects={params.projects.map((value) => value ?? slug)}
              tasks={params.tasks}
              onOpenTask={(projectSlug, taskId) => router.push(`/projects/${projectSlug}/tasks/${taskId}`)}
              onClearSlot={(slot) => assign(slot, null, null)}
              className="min-h-0 flex-1"
            />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
