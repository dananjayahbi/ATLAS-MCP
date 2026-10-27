import type { ListResponse, TaskDetailDTO, TaskSummaryDTO } from "@/lib/types/api";
import { apiGet, apiPost } from "./client";

/** Doc 01 §12 — review gate. Approve accepts an **empty body** (Doc 06 §18.2). */

export type ReviewRejectBody = { review_notes: string };

export const reviewsApi = {
  list: (signal?: AbortSignal) => apiGet<ListResponse<TaskDetailDTO>>("/reviews/", { signal }),
  get: (id: string, signal?: AbortSignal) => apiGet<TaskDetailDTO>(`/tasks/${id}/`, { signal }),
  approve: (id: string) => apiPost<TaskSummaryDTO>(`/reviews/${id}/approve/`, {}),
  reject: (id: string, notes: string) =>
    apiPost<TaskSummaryDTO>(`/reviews/${id}/reject/`, { review_notes: notes } satisfies ReviewRejectBody),
};
