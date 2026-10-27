import type {
  DiscoveryDTO,
  ListResponse,
  PriorityMatrixResponse,
  ProjectDTO,
  TaskDetailDTO,
  TaskSummaryDTO,
  TelemetrySummaryDTO,
} from "@/lib/types/api";
import discoveriesJson from "@/lib/mocks/discoveries.json";
import matrixJson from "@/lib/mocks/matrix.json";
import projectsJson from "@/lib/mocks/projects.json";
import reviewsJson from "@/lib/mocks/reviews.json";
import tasksAlphaJson from "@/lib/mocks/tasks_alpha.json";
import tasksBetaJson from "@/lib/mocks/tasks_beta.json";
import taskDetailJson from "@/lib/mocks/task_detail.json";
import telemetryJson from "@/lib/mocks/telemetry.json";

/**
 * Doc 01 §16 fixture pack held in memory. Mutations are applied here so the HUD
 * stays interactive without Django; `fixtures.ts` maps URLs onto this store.
 */

export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export type MockDb = {
  projects: ProjectDTO[];
  tasks: Record<string, TaskSummaryDTO>;
  details: Record<string, TaskDetailDTO>;
  discoveries: DiscoveryDTO[];
  reviews: TaskDetailDTO[];
  matrix: PriorityMatrixResponse;
  telemetry: TelemetrySummaryDTO;
};

export function stripDetail(detail: TaskDetailDTO): TaskSummaryDTO {
  const {
    description: _description,
    definition_of_done: _dod,
    blocked_by: _blockedBy,
    blocks: _blocks,
    child_task_ids: _children,
    discovered_during_task_id: _discovered,
    discovery_reason: _reason,
    suggested_priority: _suggested,
    review_summary: _summary,
    review_notes: _notes,
    attempt_count: _attempts,
    assets: _assets,
    recent_events: _events,
    ...summary
  } = detail;
  return summary;
}

function buildDb(): MockDb {
  const projects = clone(projectsJson) as unknown as ProjectDTO[];
  const alpha = (clone(tasksAlphaJson) as unknown as ListResponse<TaskSummaryDTO>).items;
  const beta = (clone(tasksBetaJson) as unknown as ListResponse<TaskSummaryDTO>).items;
  const tasks: Record<string, TaskSummaryDTO> = {};
  for (const task of [...alpha, ...beta]) tasks[task.id] = task;

  const details: Record<string, TaskDetailDTO> = {};
  const seedDetail = clone(taskDetailJson) as unknown as TaskDetailDTO;
  details[seedDetail.id] = seedDetail;
  tasks[seedDetail.id] = { ...tasks[seedDetail.id], ...stripDetail(seedDetail) };

  const reviews = (clone(reviewsJson) as unknown as ListResponse<TaskDetailDTO>).items;
  for (const review of reviews) {
    details[review.id] = details[review.id] ?? review;
    tasks[review.id] = tasks[review.id] ?? stripDetail(review);
  }

  return {
    projects,
    tasks,
    details,
    discoveries: (clone(discoveriesJson) as unknown as ListResponse<DiscoveryDTO>).items,
    reviews,
    matrix: clone(matrixJson) as unknown as PriorityMatrixResponse,
    telemetry: clone(telemetryJson) as unknown as TelemetrySummaryDTO,
  };
}

export const db: MockDb = buildDb();

/** Every id resolves to a detail; unknown tasks get a synthesized empty detail. */
export function detailFor(id: string): TaskDetailDTO | undefined {
  const existing = db.details[id];
  if (existing) return existing;
  const summary = db.tasks[id];
  if (!summary) return undefined;
  const synthesized: TaskDetailDTO = {
    ...summary,
    description: "",
    definition_of_done: [],
    blocked_by: [],
    blocks: [],
    child_task_ids: [],
    discovered_during_task_id: null,
    discovery_reason: "",
    suggested_priority: null,
    review_summary: "",
    review_notes: "",
    attempt_count: 1,
    assets: [],
    recent_events: [],
  };
  db.details[id] = synthesized;
  return synthesized;
}

export function syncCounters(): void {
  for (const project of db.projects) {
    const rows = Object.values(db.tasks).filter((task) => task.project_slug === project.slug);
    project.counters = {
      pending: rows.filter((task) => task.status === "PENDING").length,
      in_progress: rows.filter((task) => task.status === "IN_PROGRESS").length,
      in_review: rows.filter((task) => task.status === "IN_REVIEW").length,
      completed: rows.filter((task) => task.status === "COMPLETED").length,
      pending_approval: rows.filter((task) => task.status === "PENDING_APPROVAL").length,
      health_percent: project.counters.health_percent,
    };
    if (!rows.some((task) => task.status === "IN_PROGRESS")) project.active_agent_id = null;
  }
  db.telemetry.discoveries_pending = db.discoveries.filter((d) => d.status === "PENDING_APPROVAL").length;
}

export function listOf<T>(items: T[]): ListResponse<T> {
  return { items: clone(items), next_cursor: null };
}

export function pickMatrix(x: "age_hours" | "dependency_weight"): PriorityMatrixResponse {
  // `PriorityMatrixResponse.axes.x` is frozen to the literal "age_hours"; the alternate
  // axis is carried by `x_alternate` and needs a widening cast to be expressible.
  const axes = { x, x_alternate: "dependency_weight", y: db.matrix.axes.y, y_max: db.matrix.axes.y_max };
  return { points: clone(db.matrix.points), axes: axes as PriorityMatrixResponse["axes"] };
}
