import type { ClaimLimitRequestDTO, ListResponse } from "@/lib/types/api";
import { apiGet, apiPost } from "./client";

export type ResolveClaimLimitBody = { approve: boolean; note?: string; granted_limit?: number };

export const claimLimitsApi = {
  pending: (slug: string, signal?: AbortSignal) =>
    apiGet<ListResponse<ClaimLimitRequestDTO>>(`/claim-limit-requests/?project_slug=${encodeURIComponent(slug)}`, { signal }),
  resolve: (id: string, body: ResolveClaimLimitBody) =>
    apiPost<ClaimLimitRequestDTO>(`/claim-limit-requests/${encodeURIComponent(id)}/resolve/`, body),
};
