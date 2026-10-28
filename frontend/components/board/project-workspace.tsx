"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePriorityMatrix, useArchiveTask, useProject, useProjects, useSetTaskStatus, useTask, useTasks, useTelemetry } from "@/lib/api/queries";
import { errorMessage } from "@/lib/api/errors";
import { toast } from "@/hooks/use-toast";
import type { MatrixXAxis } from "@/lib/api/telemetry";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useBulkTasks } from "@/hooks/use-bulk-tasks";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { rememberProject } from "@/hooks/use-last-project";
import { useTaskAssetPreviews } from "@/hooks/use-task-asset-previews";
import { useUrlState } from "@/hooks/use-url-state";
import type { ProjectDTO, TaskSummaryDTO } from "@/lib/types/api";
import type { TaskStatus } from "@/lib/types/enums";
import { PageShell } from "@/components/hud/hud-frame";
import { TelemetryStrip } from "@/components/hud/telemetry-strip";
import { SplitAgentWorkbench } from "@/components/board/split-agent-workbench";
import { TaskBoardView, type BoardGrouping } from "@/components/board/board-view";
import { TaskCard } from "@/components/board/task-card";
import { WorkspaceRail } from "@/components/board/workspace-rail";
import { PriorityMatrix } from "@/components/matrix/priority-matrix";
import { MarkupModal, type MarkupImageEntry } from "@/components/markup/markup-modal";
import { EditProjectDialog } from "@/components/projects/edit-project-dialog";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { EditTaskDialog } from "@/components/tasks/edit-task-dialog";
import { TaskBulkBar } from "@/components/tasks/task-bulk-bar";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { DeleteTaskDialog } from "@/components/tasks/delete-task-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import { Kbd } from "@/components/ui/kbd";

/** Doc 06 §5/§7/§8 — split multi-agent board workspace for one project. */

export type ProjectWorkspaceProps = {
  slug: string;
  className?: string;
};

type View = "board" | "list" | "matrix";

const VIEWS = [
  { id: "board", label: "Board" },
  { id: "list", label: "List" },
  { id: "matrix", label: "Matrix" },
] as const;

export function ProjectWorkspace({ slug, className }: ProjectWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = useProject(slug);
  const projectsQuery = useProjects();
  const telemetry = useTelemetry();
  const { params, setLayout, assign } = useUrlState();
  const { filter, setQuery, setStatuses, setAgent, setBlockedOnly, setPriorityMin, setSort, reset } =
    useBoardFilter();
  const bulk = useBulkTasks();
  const [group, setGroup] = useState<BoardGrouping>("status");
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [matrixAxis, setMatrixAxis] = useState<MatrixXAxis>("age_hours");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [markup, setMarkup] = useState<{ taskId: string; assetId: string } | null>(null);
  const [settingsProject, setSettingsProject] = useState<ProjectDTO | null>(null);
  const [deleteTask, setDeleteTask] = useState<{ id: string; title: string } | null>(null);
  const archiveTask = useArchiveTask();

  const view = (searchParams.get("view") ?? "board") as View;
  // `unbounded` is only used for the filter bar's agent list and totals, so the
  // bar keeps showing the full project scope while a search is active.
  const unbounded = useTasks(slug, {}, { kind: "board" });
  const filtered = useTasks(slug, filter, { kind: "list" });
  const matrix = usePriorityMatrix(matrixAxis);
  const previews = useTaskAssetPreviews(slug);
  const editing = useTask(editTaskId ?? "");
  const setStatus = useSetTaskStatus();
  const [dragging, setDragging] = useState<TaskStatus | null>(null);

  // Remember the last project so the header's Dashboard link can return here.
  useEffect(() => rememberProject(slug), [slug]);

  // Doc 06 §12.1 — `n` opens the composer, `x` toggles bulk selection on the
  // highlighted row, `Esc` clears the selection.
  useHotkeys(
    [
      { key: "n", scopes: ["global"], run: () => setCreateOpen(true) },
      {
        key: "x",
        scopes: ["global"],
        run: () => {
          const first = ordered[0];
          if (first) toggleSelection(first.id);
        },
      },
      {
        key: "Escape",
        scopes: ["global"],
        allowInInput: true,
        run: () => {
          if (selection.size > 0) {
            setSelection(new Set());
            return true;
          }
          return false;
        },
      },
    ],
    { scopeStack: ["global"] },
  );

  const all = unbounded.data?.items ?? [];
  const rows = filtered.data?.items ?? [];

  const agents = useMemo(
    () => [...new Set(all.map((task) => task.assigned_agent_id).filter((id): id is string => Boolean(id)))].sort(),
    [all],
  );

  const ordered = useMemo(
    () => [...rows].sort((a, b) => b.priority - a.priority || b.age_hours - a.age_hours),
    [rows],
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

  const selectedTasks = useMemo(
    () => ordered.filter((task) => selection.has(task.id)),
    [ordered, selection],
  );

  const previewFor = (taskId: string) => previews.index.get(taskId);

  /**
   * Drag-and-drop status change. The card drag sets `dragging` through the DOM
   * `dragstart` event, which bubbles here, so a column can pre-highlight the
   * targets the guard table will actually accept.
   */
  const moveTask = (taskId: string, status: TaskStatus) => {
    setDragging(null);
    const task = ordered.find((row) => row.id === taskId);
    if (!task || task.status === status) return;
    void setStatus
      .mutateAsync({ id: taskId, status, note: status === "PENDING" ? "Reopened from the board." : "" })
      .catch(() => {
        /* The mutation surface renders `errorMessage`; nothing to add here. */
      });
  };

  /**
   * Archive from a card. Archiving is reversible, so it commits immediately and
   * the toast reports it; the row disappears when the list invalidates.
   */
  const archiveRow = (id: string, title: string) => {
    void archiveTask
      .mutateAsync({ id, archived: true })
      .then(() => toast({ level: "warn", title: `Task archived: ${title}` }))
      .catch((err: unknown) => toast({ level: "error", title: errorMessage(err) }));
  };

  /** Every image on a task, so the markup rail can switch without a refetch. */
  const markupImages: MarkupImageEntry[] = useMemo(() => {
    const entry = markup ? previews.index.get(markup.taskId) : undefined;
    if (!entry) return [];
    return entry.images.map((image) => ({
      id: image.id,
      label: image.filename,
      url: image.url,
      kind: image.kind,
      mimeType: image.mime_type,
      version: image.version,
    }));
  }, [markup, previews.index]);

  const markupTask = markup ? ordered.find((task) => task.id === markup.taskId) ?? null : null;
  const editingTask = editing.data ?? null;

  return (
    <PageShell
      title={project.data?.name ?? slug}
      subtitle={`${slug} · ${ordered.length} tasks · ${params.layout}`}
      actions={
        <>
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
            New task <Kbd size="xs">N</Kbd>
          </Button>
          <Tabs items={[...VIEWS]} value={view} onChange={setView} />
        </>
      }
      className={className}
    >
      <div className="flex min-h-0 flex-col gap-3">
        <TelemetryStrip telemetry={telemetry.data} />

        <div
          className="grid min-h-0 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]"
          onDragStart={(event) => {
            const id = (event.target as HTMLElement).closest("[data-task-id]")?.getAttribute("data-task-id");
            const task = id ? ordered.find((row) => row.id === id) : null;
            setDragging(task?.status ?? null);
          }}
          onDragEnd={() => setDragging(null)}
        >
          <WorkspaceRail
            projects={projectsQuery.data?.items ?? []}
            loading={projectsQuery.isLoading}
            onCreateProject={() => router.push("/")}
            onEditProject={setSettingsProject}
          />

          <div className="flex min-h-0 flex-col gap-3">
            {project.isError ? (
              <p role="alert" className="text-hud-body text-critical-hot">
                Project {slug} could not be loaded.
                <Button size="sm" className="ml-2" onClick={() => project.refetch()}>
                  Retry
                </Button>
              </p>
            ) : null}

            {view !== "matrix" ? (
              <TaskFilterBar
                q={filter.q ?? ""}
                onQueryChange={setQuery}
                statuses={filter.status ?? []}
                onStatusesChange={setStatuses}
                agents={agents}
                agent={filter.agent}
                onAgentChange={setAgent}
                blockedOnly={filter.blocked === true}
                onBlockedOnlyChange={setBlockedOnly}
                priorityMin={filter.priorityMin}
                onPriorityMinChange={setPriorityMin}
                sort={filter.sort ?? "priority"}
                onSortChange={setSort}
                total={all.length}
                shown={ordered.length}
                onReset={reset}
              />
            ) : null}

            {view !== "matrix" ? (
              <TaskBulkBar
                selected={selectedTasks}
                onClear={() => setSelection(new Set())}
                busy={bulk.running}
                progress={bulk.progress}
                error={bulk.lastError}
                onSetPriority={(priority) => void bulk.run("setPriority", [...selection], priority)}
                onNudge={(delta) => {
                  // Doc 06 §8.7 allows ±5, clamped per row — computed client-side.
                  const ids = [...selection];
                  void (async () => {
                    for (const id of ids) {
                      const task = ordered.find((row) => row.id === id);
                      if (task) await bulk.run("nudge", [id], task.priority + delta);
                    }
                  })();
                }}
                onRequeue={() => void bulk.run("requeue", [...selection])}
                onArchive={() => void bulk.run("archive", [...selection])}
              />
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
                state={filtered.isLoading && !filtered.data ? "loading" : "idle"}
              >
                {ordered.length === 0 ? (
                  <EmptyState
                    inline
                    title={all.length === 0 ? "No tasks yet" : "No tasks match these filters"}
                    hint={all.length === 0 ? "Create the first task to get started." : "Clear the filters to see all tasks."}
                  />
                ) : (
                  <ul role="list" className="flex flex-col gap-1">
                    {ordered.map((task) => (
                      <li key={task.id}>
                        <TaskCard
                          task={task}
                          selected={selection.has(task.id)}
                          onSelect={toggleSelection}
                          onOpen={() => openTask(task)}
                          thumbnails={previewFor(task.id)?.images}
                          thumbnailTotal={previewFor(task.id)?.total}
                          onOpenImage={(taskId, assetId) => setMarkup({ taskId, assetId })}
                          onEdit={setEditTaskId}
                          onArchive={(id) => archiveRow(id, task.title)}
                          onDelete={(id) => setDeleteTask({ id, title: task.title })}
                          busy={archiveTask.isPending && archiveTask.variables?.id === task.id}
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
                meta={filtered.isFetching ? "syncing" : `${ordered.length} tasks`}
                state={filtered.isLoading && !filtered.data ? "loading" : "idle"}
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
                  previewFor={previewFor}
                  onOpenImage={(taskId, assetId) => setMarkup({ taskId, assetId })}
                  onEditTask={(id) => setEditTaskId(id)}
                  onArchiveTask={(id) => {
                    const task = ordered.find((row) => row.id === id);
                    archiveRow(id, task?.title ?? "task");
                  }}
                  onDeleteTask={(id) => {
                    const task = ordered.find((row) => row.id === id);
                    setDeleteTask({ id, title: task?.title ?? "task" });
                  }}
                  busyTaskId={archiveTask.isPending ? (archiveTask.variables?.id ?? null) : null}
                  onMoveTask={moveTask}
                  draggingStatus={dragging}
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

      <CreateTaskDialog
        open={createOpen}
        slug={slug}
        onClose={() => setCreateOpen(false)}
        candidates={all.filter((task) => task.status !== "COMPLETED")}
        onCreated={(task) => router.push(`/projects/${slug}/tasks/${task.id}`)}
      />

      {editingTask ? (
        <EditTaskDialog
          open={editTaskId !== null}
          task={editingTask}
          onClose={() => setEditTaskId(null)}
          candidates={all}
          onArchived={() => {
            setEditTaskId(null);
            void previews.refetch();
          }}
          onDeleted={() => {
            setEditTaskId(null);
            setSelection((prev) => {
              const next = new Set(prev);
              next.delete(editTaskId ?? "");
              return next;
            });
          }}
          onAssetsChanged={() => void previews.refetch()}
        />
      ) : null}

      <DeleteTaskDialog
        open={deleteTask !== null}
        taskId={deleteTask?.id ?? ""}
        taskTitle={deleteTask?.title ?? "task"}
        onClose={() => setDeleteTask(null)}
        onDeleted={() => void previews.refetch()}
        onArchive={
          deleteTask
            ? () => {
                archiveRow(deleteTask.id, deleteTask.title);
                setDeleteTask(null);
              }
            : undefined
        }
      />

      <MarkupModal
        open={markup !== null}
        taskId={markup?.taskId ?? ""}
        taskTitle={markupTask?.title ?? "task"}
        assetId={markup?.assetId ?? null}
        images={markupImages}
        onClose={() => setMarkup(null)}
        onSaved={() => void previews.refetch()}
      />

      {settingsProject ? (
        <EditProjectDialog
          open
          project={projectsQuery.data?.items.find((row) => row.slug === settingsProject.slug) ?? settingsProject}
          onClose={() => setSettingsProject(null)}
          onSaved={(saved) => setSettingsProject(saved)}
        />
      ) : null}
    </PageShell>
  );
}
