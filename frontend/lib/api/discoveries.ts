import type { DiscoveryDTO, ListResponse, TaskSummaryDTO } from "@/lib/types/api";
import { apiGet, apiPost } from "./client";

/** Doc 01 §12 — discovery triage. T3 sets priority from the explicit body (§9.4). */

export type DiscoveryApproveBody = { priority: number };
export type DiscoveryRejectBody = { reason: string | null };

export const discoveriesApi = {
  list: (signal?: AbortSignal) => apiGet<ListResponse<DiscoveryDTO>>("/discoveries/", { signal }),
  /** `priority` is always explicit — never omitted, so the server need not guess. */
  approve: (id: string, body: DiscoveryApproveBody) =>
    apiPost<TaskSummaryDTO>(`/discoveries/${id}/approve/`, body),
  /** The route has no required body; `{reason:null}` is sent for shape stability. */
  reject: (id: string, body: DiscoveryRejectBody = { reason: null }) =>
    apiPost<DiscoveryDTO>(`/discoveries/${id}/reject/`, body),
};
