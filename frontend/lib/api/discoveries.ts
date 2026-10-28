import type { DiscoveryDTO, ListResponse } from "@/lib/types/api";
import { apiGet, apiPatch, apiPost } from "./client";

/** Doc 01 §12 — discovery triage. T3 sets priority from the explicit body (§9.4). */

export type DiscoveryApproveBody = { priority: number };
export type DiscoveryRejectBody = { reason: string | null };

/**
 * Every field a proposal carries is correctable before approval — the agent's
 * text becomes the task brief, so the operator owns it once they approve.
 * `status` is absent: approve/reject/restore own the transitions.
 */
export type DiscoveryUpdateBody = {
  title?: string;
  description?: string;
  priority?: number;
  discovery_reason?: string;
  dod_items?: string[];
};

export const discoveriesApi = {
  list: (signal?: AbortSignal) => apiGet<ListResponse<DiscoveryDTO>>("/discoveries/", { signal }),
  /**
   * `priority` is always explicit — never omitted, so the server need not guess.
   * The route answers with the full `DiscoveryDTO` (post-transition), not a
   * `TaskSummaryDTO`; typing it as the latter made every caller read fields that
   * were never sent.
   */
  approve: (id: string, body: DiscoveryApproveBody) =>
    apiPost<DiscoveryDTO>(`/discoveries/${id}/approve/`, body),
  /** The route has no required body; `{reason:null}` is sent for shape stability. */
  reject: (id: string, body: DiscoveryRejectBody = { reason: null }) =>
    apiPost<DiscoveryDTO>(`/discoveries/${id}/reject/`, body),
  /** Undo a triage decision; the server owns the REJECTED → PENDING_APPROVAL guard. */
  restore: (id: string) => apiPost<DiscoveryDTO>(`/discoveries/${id}/restore/`),
  /** Full-context correction of a pending proposal. */
  update: (id: string, body: DiscoveryUpdateBody) =>
    apiPatch<DiscoveryDTO>(`/discoveries/${id}/`, body),
};
