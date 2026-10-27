import type { DiscoveryDTO, TaskSummaryDTO } from "@/lib/types/api";
import { ApiError } from "./client";
import { clone, db, detailFor, listOf, pickMatrix, stripDetail, syncCounters } from "./mock-store";

/**
 * Resolves a `/api/v1/...` request against the fixture pack. Throws `ApiError`
 * exactly like the live API, so error paths are exercised in mock mode too.
 */

type MockBody = Record<string, unknown> | undefined;

const NOT_FOUND = (entity: string) => new ApiError("TASK_NOT_FOUND", 404, `${entity} no longer exists`);

function invalidTransition(action: string, from: string, verb = action) {
  return new ApiError("INVALID_TRANSITION", 409, `Cannot ${verb} from ${from}`, false, { action, from });
}

function createTaskFromDiscovery(discovery: DiscoveryDTO): TaskSummaryDTO {
  const now = new Date().toISOString();
  const task: TaskSummaryDTO = {
    id: discovery.task_id,
    project_slug: discovery.project_slug,
    title: discovery.title,
    status: "PENDING",
    priority: discovery.priority,
    dod_progress_percent: 0,
    is_agent_discovered: true,
    is_blocked: false,
    parent_task_id: null,
    age_hours: 0,
    dependency_weight: 0,
    assigned_agent_id: null,
    lease_seconds_remaining: null,
    created_at: discovery.created_at ?? now,
    updated_at: now,
  };
  db.tasks[task.id] = task;
  return task;
}

function handleTaskAction(id: string, action: string) {
  const detail = detailFor(id);
  if (!detail) throw NOT_FOUND(`Task ${id}`);
  if (action === "force-release" && detail.status !== "IN_PROGRESS") {
    throw invalidTransition("force_release", detail.status);
  }
  if (action === "requeue" && detail.status !== "REJECTED") {
    throw invalidTransition("requeue", detail.status);
  }
  detail.status = action === "archive" ? "REJECTED" : "PENDING";
  detail.assigned_agent_id = null;
  detail.lease_seconds_remaining = null;
  db.tasks[id] = { ...db.tasks[id], ...stripDetail(detail) };
  db.reviews = db.reviews.filter((review) => review.id !== id);
  syncCounters();
  return clone(db.tasks[id]);
}

function toggleDod(id: string, itemId: number, completed: boolean) {
  const detail = detailFor(id);
  if (!detail) throw NOT_FOUND(`Task ${id}`);
  const item = detail.definition_of_done.find((entry) => entry.id === itemId);
  if (!item) throw new ApiError("TASK_NOT_FOUND", 404, "Checklist item no longer exists");
  item.completed = completed;
  item.completed_at = completed ? new Date().toISOString() : null;
  const total = detail.definition_of_done.length;
  const done = detail.definition_of_done.filter((entry) => entry.completed).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  detail.dod_progress_percent = percent;
  db.tasks[id] = { ...db.tasks[id], dod_progress_percent: percent };
  return clone(detail);
}

function resolveReview(id: string, verb: string, payload: MockBody) {
  const detail = detailFor(id);
  if (!detail) throw NOT_FOUND(`Task ${id}`);
  if (detail.status !== "IN_REVIEW") throw invalidTransition(verb, detail.status, verb === "approve" ? "sign_off" : verb);
  if (verb === "reject" && String(payload?.review_notes ?? "").trim().length === 0) {
    throw new ApiError("VALIDATION_ERROR", 400, "review_notes is required to reject (T9)", false, {
      field: "review_notes",
    });
  }
  detail.status = verb === "approve" ? "COMPLETED" : "PENDING";
  detail.review_notes = String(payload?.review_notes ?? "");
  db.tasks[id] = { ...db.tasks[id], ...stripDetail(detail) };
  db.reviews = db.reviews.filter((review) => review.id !== id);
  syncCounters();
  return clone(db.tasks[id]);
}

function resolveDiscovery(id: string, verb: string, payload: MockBody) {
  const index = db.discoveries.findIndex((discovery) => discovery.task_id === id);
  if (index < 0) throw NOT_FOUND("Discovery");
  const discovery = db.discoveries[index];
  db.discoveries.splice(index, 1);

  if (verb === "reject") {
    discovery.status = "REJECTED";
    syncCounters();
    return clone(discovery);
  }

  const priority = Number(payload?.priority ?? discovery.suggested_priority);
  discovery.status = "PENDING";
  discovery.priority = priority;
  const task = db.tasks[discovery.task_id] ?? createTaskFromDiscovery(discovery);
  task.status = "PENDING";
  task.priority = priority;
  db.tasks[task.id] = task;
  syncCounters();
  return clone(task);
}

export function resolveMockRequest<T>(url: string, method: string, body?: unknown): T {
  const parsed = new URL(url, "http://mock.local");
  const path = parsed.pathname.replace(/^\/api\/v1/, "");
  const payload = (body ?? {}) as MockBody;
  const verb = method.toUpperCase();
  let match: RegExpMatchArray | null;

  if (path === "/projects" && verb === "GET") return listOf(db.projects) as T;

  if ((match = path.match(/^\/projects\/([^/]+)$/))) {
    const project = db.projects.find((entry) => entry.slug === decodeURIComponent(match![1]));
    if (!project) throw new ApiError("PROJECT_NOT_FOUND", 404, "Project no longer exists");
    if (verb === "PATCH") Object.assign(project, payload);
    return clone(project) as T;
  }

  if ((match = path.match(/^\/projects\/([^/]+)\/tasks$/))) {
    const slug = decodeURIComponent(match[1]);
    if (verb === "POST") {
      const now = new Date().toISOString();
      const task: TaskSummaryDTO = {
        id: `local-${Date.now()}`,
        project_slug: slug,
        title: String(payload?.title ?? "Untitled"),
        status: "PENDING",
        priority: Number(payload?.priority ?? 50),
        dod_progress_percent: 0,
        is_agent_discovered: false,
        is_blocked: false,
        parent_task_id: null,
        age_hours: 0,
        dependency_weight: 0,
        assigned_agent_id: null,
        lease_seconds_remaining: null,
        created_at: now,
        updated_at: now,
      };
      db.tasks[task.id] = task;
      syncCounters();
      return clone(task) as T;
    }
    return listOf(Object.values(db.tasks).filter((task) => task.project_slug === slug)) as T;
  }

  if ((match = path.match(/^\/tasks\/([^/]+)$/))) {
    const id = decodeURIComponent(match[1]);
    const detail = detailFor(id);
    if (!detail) throw NOT_FOUND(`Task ${id}`);
    if (verb === "PATCH") {
      Object.assign(detail, payload);
      db.tasks[id] = { ...db.tasks[id], ...stripDetail(detail) };
      syncCounters();
    }
    return clone(detail) as T;
  }

  if ((match = path.match(/^\/tasks\/([^/]+)\/priority$/)) && verb === "PATCH") {
    const id = decodeURIComponent(match[1]);
    const next = Number(payload?.priority ?? 0);
    if (!Number.isInteger(next) || next < 0 || next > 100) {
      throw new ApiError("VALIDATION_ERROR", 400, "priority must be between 0 and 100", false, { field: "priority" });
    }
    const detail = detailFor(id);
    if (!detail) throw NOT_FOUND(`Task ${id}`);
    detail.priority = next;
    db.tasks[id] = { ...db.tasks[id], priority: next };
    return clone(db.tasks[id]) as T;
  }

  if ((match = path.match(/^\/tasks\/([^/]+)\/dod\/([^/]+)$/)) && verb === "PATCH") {
    return toggleDod(decodeURIComponent(match[1]), Number(decodeURIComponent(match[2])), Boolean(payload?.completed)) as T;
  }

  if ((match = path.match(/^\/tasks\/([^/]+)\/(force-release|requeue|archive)$/)) && verb === "POST") {
    return handleTaskAction(decodeURIComponent(match[1]), match[2]) as T;
  }

  if (path === "/discoveries" && verb === "GET") {
    return listOf(db.discoveries.filter((discovery) => discovery.status === "PENDING_APPROVAL")) as T;
  }

  if ((match = path.match(/^\/discoveries\/([^/]+)\/(approve|reject)$/)) && verb === "POST") {
    return resolveDiscovery(decodeURIComponent(match[1]), match[2], payload) as T;
  }

  if (path === "/reviews" && verb === "GET") return listOf(db.reviews) as T;

  if ((match = path.match(/^\/reviews\/([^/]+)\/(approve|reject)$/)) && verb === "POST") {
    return resolveReview(decodeURIComponent(match[1]), match[2], payload) as T;
  }

  if (path === "/telemetry/summary" && verb === "GET") {
    db.telemetry.generated_at = new Date().toISOString();
    return clone(db.telemetry) as T;
  }

  if (path === "/priority-matrix" && verb === "GET") {
    const axis = parsed.searchParams.get("x");
    return pickMatrix(axis === "dependency_weight" ? "dependency_weight" : "age_hours") as T;
  }

  throw new ApiError("INTERNAL_ERROR", 500, `No mock fixture for ${verb} ${path}`);
}
