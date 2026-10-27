import type { ListResponse, TaskDetailDTO, TaskSummaryDTO } from "@/lib/types/api";
import type { TaskStatus } from "@/lib/types/enums";
import { apiGet, apiPatch, apiPost } from "./client";

/** Doc 01 §12 — every task route lives here; no URL string exists outside this module. */

export type TaskListQuery = {
  status?: TaskStatus[] | null;
  q?: string | null;
  agent?: string | null;
  blocked?: boolean | null;
  discovered?: boolean | null;
  priorityMin?: number | null;
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
    cursor: query.cursor,
    limit: query.limit,
  };
}

export type TaskCreateBody = {
  title: string;
  description: string;
  priority?: number;
  blocked_by?: string[];
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
  patch: (id: string, body: Partial<TaskDetailDTO>) => apiPatch<TaskDetailDTO>(`/tasks/${id}/`, body),
  setPriority: (id: string, priority: number) => apiPatch<TaskSummaryDTO>(`/tasks/${id}/priority/`, { priority }),
  /** `completed` is sent explicitly so the server never has to infer a toggle. */
  toggleDod: (id: string, itemId: number, completed: boolean) =>
    apiPatch<TaskDetailDTO>(`/tasks/${id}/dod/${itemId}/`, { completed }),
  forceRelease: (id: string) => apiPost<TaskSummaryDTO>(`/tasks/${id}/force-release/`),
  requeue: (id: string) => apiPost<TaskSummaryDTO>(`/tasks/${id}/requeue/`),
  archive: (id: string) => apiPost<TaskSummaryDTO>(`/tasks/${id}/archive/`),
};
