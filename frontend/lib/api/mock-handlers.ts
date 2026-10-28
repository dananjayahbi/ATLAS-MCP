import type { DiscoveryDTO, TaskSummaryDTO } from "@/lib/types/api";
import { ApiError } from "./client";
import { clone, db, detailFor, stripDetail, syncCounters } from "./mock-store";

/** Mutating mock handlers — one per state-machine edge in Doc 01 §8. */

type MockBody = Record<string, unknown> | undefined;

const notFound = (entity: string) => new ApiError("TASK_NOT_FOUND", 404, `${entity} no longer exists`);

function invalidTransition(action: string, from: string, verb = action) {
  return new ApiError("INVALID_TRANSITION", 409, `Cannot ${verb} from ${from}`, false, { action, from });
}

export function createTaskFromDiscovery(discovery: DiscoveryDTO): TaskSummaryDTO {
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
    archived_at: null,
  };
  db.tasks[task.id] = task;
  return task;
}

export function setPriority(id: string, priority: number): TaskSummaryDTO {
  const next = Number(priority);
  if (!Number.isInteger(next) || next < 0 || next > 100) {
    throw new ApiError("VALIDATION_ERROR", 400, "priority must be between 0 and 100", false, { field: "priority" });
  }
  const detail = detailFor(id);
  if (!detail) throw notFound(`Task ${id}`);
  detail.priority = next;
  db.tasks[id] = { ...db.tasks[id], priority: next };
  return clone(db.tasks[id]);
}

export function toggleDodItem(id: string, itemId: number, completed: boolean) {
  const detail = detailFor(id);
  if (!detail) throw notFound(`Task ${id}`);
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

export function applyTaskAction(id: string, action: string, archived: boolean | null = null) {
  const detail = detailFor(id);
  if (!detail) throw notFound(`Task ${id}`);
  if (action === "force-release" && detail.status !== "IN_PROGRESS") {
    throw invalidTransition("force_release", detail.status);
  }
  if (action === "requeue" && detail.status !== "REJECTED") {
    throw invalidTransition("requeue", detail.status);
  }
  // `POST /archive/` is a toggle: `{archived: false}` restores, and a body with
  // no flag means "archive". Restore is the requeue transition plus a cleared stamp.
  const restoring = action === "archive" && archived === false;
  if (action === "archive" && !restoring && detail.archived_at === null && detail.status !== "PENDING" && detail.status !== "REJECTED") {
    throw invalidTransition("archive_task", detail.status);
  }
  if (restoring && detail.archived_at === null) {
    throw invalidTransition("restore_task", detail.status);
  }
  detail.archived_at = restoring ? null : action === "archive" ? new Date().toISOString() : detail.archived_at;
  detail.status = action === "archive" && !restoring ? "REJECTED" : "PENDING";
  detail.assigned_agent_id = null;
  detail.lease_seconds_remaining = null;
  db.tasks[id] = { ...db.tasks[id], ...stripDetail(detail) };
  if (!restoring) db.reviews = db.reviews.filter((review) => review.id !== id);
  syncCounters();
  return clone(db.tasks[id]);
}

export function resolveReview(id: string, verb: string, payload: MockBody) {
  const detail = detailFor(id);
  if (!detail) throw notFound(`Task ${id}`);
  if (detail.status !== "IN_REVIEW") {
    throw invalidTransition(verb, detail.status, verb === "approve" ? "sign_off" : verb);
  }
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

export function resolveDiscovery(id: string, verb: string, payload: MockBody) {
  const index = db.discoveries.findIndex((discovery) => discovery.task_id === id);
  if (index < 0) throw notFound("Discovery");
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

export function createTask(slug: string, payload: MockBody): TaskSummaryDTO {
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
    archived_at: null,
  };
  db.tasks[task.id] = task;
  syncCounters();
  return clone(task);
}
