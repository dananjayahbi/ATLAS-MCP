import type { ProjectDTO, TaskDetailDTO } from "@/lib/types/api";
import type { TaskStatus } from "@/lib/types/enums";
import { ApiError } from "./client";
import { clone, db, detailFor, stripDetail, syncCounters } from "./mock-store";

/**
 * Mock counterparts of the operator edit routes, kept in their own module so
 * `mock-handlers.ts` stays focused on the Doc 01 §8 state machine. Mirrors the
 * guards in `backend/core/services/tasks.py` so a mock-mode bug surfaces here
 * instead of only against a live backend.
 */

function invalidTransition(action: string, from: string, message?: string) {
  return new ApiError("INVALID_TRANSITION", 409, message ?? `Cannot ${action} from ${from}`, false, {
    action,
    from,
  });
}
const TASK_STATUSES: readonly TaskStatus[] = [
  "PENDING_APPROVAL",
  "PENDING",
  "IN_PROGRESS",
  "IN_REVIEW",
  "COMPLETED",
  "REJECTED",
];

/** Statuses a human may set directly, and the source statuses each is legal from. */
const MANUAL_TARGETS: Record<TaskStatus, readonly TaskStatus[]> = {
  PENDING_APPROVAL: [],
  PENDING: ["REJECTED", "IN_PROGRESS", "IN_REVIEW"],
  IN_PROGRESS: ["PENDING"],
  IN_REVIEW: [],
  COMPLETED: ["IN_REVIEW"],
  REJECTED: ["PENDING", "REJECTED"],
};

export function updateProject(project: ProjectDTO, payload: Record<string, unknown> | undefined): ProjectDTO {
  if (!payload) return project;
  if ("slug" in payload) {
    throw new ApiError("VALIDATION_ERROR", 400, "slug is immutable", false, { field: "slug" });
  }
  const nextName = payload.name;
  if (typeof nextName === "string" && nextName.trim().length === 0) {
    throw new ApiError("VALIDATION_ERROR", 400, "name cannot be blank", false, { field: "name" });
  }
  if (typeof payload.accent_color === "string" && !/^#[0-9A-Fa-f]{6}$/.test(payload.accent_color)) {
    throw new ApiError("VALIDATION_ERROR", 400, "accent_color must be #RRGGBB", false, {
      field: "accent_color",
    });
  }
  for (const key of ["name", "local_repo_path", "accent_color", "global_rules_md"] as const) {
    const value = payload[key];
    if (typeof value === "string") project[key] = value;
  }
  project.updated_at = new Date().toISOString();
  return project;
}

export function setStatus(id: string, to: TaskStatus, note: string): TaskDetailDTO {
  const detail = detailFor(id);
  if (!detail) throw new ApiError("TASK_NOT_FOUND", 404, `Task ${id} no longer exists`);
  if (!TASK_STATUSES.includes(to)) {
    throw new ApiError("VALIDATION_ERROR", 400, "Unknown status", false, { field: "status" });
  }
  if (to === detail.status) {
    throw invalidTransition(`set_status:${to}`, detail.status, "Task is already in that status.");
  }
  if (!MANUAL_TARGETS[to].includes(detail.status)) {
    throw invalidTransition(`set_status:${to}`, detail.status);
  }
  if (to === "PENDING" && detail.status === "IN_REVIEW" && note.trim().length === 0) {
    throw new ApiError("VALIDATION_ERROR", 400, "review_notes is required to reopen (T9)", false, {
      field: "note",
    });
  }

  detail.status = to;
  detail.lease_seconds_remaining = null;
  if (to === "IN_PROGRESS") detail.assigned_agent_id = detail.assigned_agent_id ?? "Agent-Manual";
  if (to === "PENDING" || to === "REJECTED") detail.assigned_agent_id = null;
  if (to === "COMPLETED") detail.review_notes = note;
  if (to === "PENDING" && note) detail.review_notes = note;

  db.tasks[id] = { ...db.tasks[id], ...stripDetail(detail) };
  syncCounters();
  return clone(detail);
}

export function setAssignee(id: string, agentIdentifier: string | null): TaskDetailDTO {
  const detail = detailFor(id);
  if (!detail) throw new ApiError("TASK_NOT_FOUND", 404, `Task ${id} no longer exists`);
  if (detail.status === "IN_PROGRESS" && detail.lease_seconds_remaining !== null) {
    throw invalidTransition(
      "set_assignee",
      detail.status,
      "Release the live lease before reassigning this task.",
    );
  }
  const value = (agentIdentifier ?? "").trim() || null;
  detail.assigned_agent_id = value;
  db.tasks[id] = { ...db.tasks[id], ...stripDetail(detail) };
  return clone(detail);
}

export function updateTaskDetail(id: string, payload: Record<string, unknown> | undefined): TaskDetailDTO {
  const detail = detailFor(id);
  if (!detail) throw new ApiError("TASK_NOT_FOUND", 404, `Task ${id} no longer exists`);
  if (detail.status === "COMPLETED") throw invalidTransition("update_task", detail.status);
  if (!payload) return clone(detail);

  if (typeof payload.title === "string") {
    if (!payload.title.trim()) {
      throw new ApiError("VALIDATION_ERROR", 400, "title must be a non-empty string", false, {
        field: "title",
      });
    }
    detail.title = payload.title.trim();
  }
  if (typeof payload.description === "string") {
    if (!payload.description.trim()) {
      throw new ApiError("VALIDATION_ERROR", 400, "description must be a non-empty string", false, {
        field: "description",
      });
    }
    detail.description = payload.description;
  }
  if (Array.isArray(payload.dod_items)) {
    const labels = payload.dod_items.map((item) => String(item).trim()).filter(Boolean);
    if (labels.length === 0) {
      throw new ApiError("VALIDATION_ERROR", 400, "definition_of_done cannot be empty", false, {
        field: "dod_items",
      });
    }
    const previous = new Map(detail.definition_of_done.map((item) => [item.label, item]));
    detail.definition_of_done = labels.map((label, index) => {
      const carried = previous.get(label);
      return {
        id: index + 1,
        label,
        completed: carried?.completed ?? false,
        completed_at: carried?.completed_at ?? null,
      };
    });
    const done = detail.definition_of_done.filter((item) => item.completed).length;
    detail.dod_progress_percent =
      detail.definition_of_done.length === 0
        ? 0
        : Math.round((done / detail.definition_of_done.length) * 100);
  }

  detail.updated_at = new Date().toISOString();
  db.tasks[id] = { ...db.tasks[id], ...stripDetail(detail) };
  syncCounters();
  return clone(detail);
}
