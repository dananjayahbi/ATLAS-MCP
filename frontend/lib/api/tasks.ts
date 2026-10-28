import type { ListResponse, TaskDetailDTO, TaskSummaryDTO } from "@/lib/types/api";
import type { TaskStatus } from "@/lib/types/enums";
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";

/** Doc 01 §12 — every task route lives here; no URL string exists outside this module. */

export type TaskListQuery = {
  status?: TaskStatus[] | null;
  q?: string | null;
  agent?: string | null;
  blocked?: boolean | null;
  discovered?: boolean | null;
  priorityMin?: number | null;
  /** `true` reads the archive; omitted/false reads the live board. */
  archived?: boolean | null;
  sort?: "priority" | "created" | "updated" | null;
  order?: "asc" | "desc" | null;
  cursor?: string | null;
  limit?: number | null;
};

function toParams(query: TaskListQuery): Record<string, string | number | boolean | null | undefined> {
  return {
    status: query.status && query.status.length > 0 ? query.status.join(",") : null,
    q: query.q,
    agent: query.agent,
    blocked: query.blocked,
    discovered: query.discovered,
    priority_min: query.priorityMin,
    archived: query.archived,
    sort: query.sort,
    order: query.order,
    cursor: query.cursor,
    limit: query.limit,
  };
}

export type TaskCreateBody = {
  title: string;
  description: string;
  priority?: number;
  /** Doc 04 §5.2 — the view accepts `dod_items` and persists it as the checklist. */
  dod_items?: string[];
  blocked_by?: string[];
  parent_task_id?: string | null;
};

export type TaskUpdateBody = {
  title?: string;
  description?: string;
  priority?: number;
  blocked_by?: string[];
  dod_items?: string[];
};

export const tasksApi = {
  list: (slug: string, query: TaskListQuery = {}, signal?: AbortSignal) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(toParams(query))) {
      if (value === null || value === undefined || value === "") continue;
      search.set(key, String(value));
    }
    const qs = search.toString();
    return apiGet<ListResponse<TaskSummaryDTO>>(
      `/projects/${encodeURIComponent(slug)}/tasks/${qs ? `?${qs}` : ""}`,
      { signal },
    );
  },
  get: (id: string, signal?: AbortSignal) => apiGet<TaskDetailDTO>(`/tasks/${id}/`, { signal }),
  create: (slug: string, body: TaskCreateBody) =>
    apiPost<TaskSummaryDTO>(`/projects/${encodeURIComponent(slug)}/tasks/`, body),
  update: (id: string, body: TaskUpdateBody) => apiPatch<TaskDetailDTO>(`/tasks/${id}/`, body),
  /** Hard delete, fenced server-side to untouched tasks (Doc 01 §8 T12 direction). */
  remove: (id: string) => apiDelete<void>(`/tasks/${id}/`),
  setStatus: (id: string, status: TaskStatus, note = "") =>
    apiPatch<TaskDetailDTO>(`/tasks/${id}/status/`, { status, note }),
  setAssignee: (id: string, agentIdentifier: string | null) =>
    apiPatch<TaskDetailDTO>(`/tasks/${id}/assignee/`, { assigned_agent_id: agentIdentifier }),
  setPriority: (id: string, priority: number) => apiPatch<TaskSummaryDTO>(`/tasks/${id}/priority/`, { priority }),
  /** `completed` is sent explicitly so the server never has to infer a toggle. */
  toggleDod: (id: string, itemId: number, completed: boolean) =>
    apiPatch<TaskDetailDTO>(`/tasks/${id}/dod/${itemId}/`, { completed }),
  forceRelease: (id: string) => apiPost<TaskSummaryDTO>(`/tasks/${id}/force-release/`),
  requeue: (id: string) => apiPost<TaskSummaryDTO>(`/tasks/${id}/requeue/`),
  /** T12 archive; `archived: false` restores the task to PENDING (T13). */
  archive: (id: string, archived = true) =>
    apiPost<TaskSummaryDTO>(`/tasks/${id}/archive/`, { archived }),
};
