import type { AssetDTO } from "@/lib/types/enums";
import type { AssetKind } from "@/lib/types/enums";
import { apiGet, apiUpload } from "./client";

/** Doc 01 §12 — assets are rendered by URL only, never fetched into JS memory (§15). */

export type AssetListResponse = { items: AssetDTO[]; next_cursor: string | null };

export const assetsApi = {
  byTask: (taskId: string, signal?: AbortSignal) =>
    apiGet<AssetListResponse>(`/assets/?task_id=${encodeURIComponent(taskId)}`, { signal }),
  contentUrl: (assetId: string): string => `/api/v1/assets/${encodeURIComponent(assetId)}/content`,
  downloadUrl: (assetId: string): string => `/api/v1/assets/${encodeURIComponent(assetId)}/download`,
  upload: (taskId: string, kind: AssetKind, file: File) => {
    const form = new FormData();
    form.set("task_id", taskId);
    form.set("kind", kind);
    form.set("file", file);
    return apiUpload<AssetDTO>("/assets/", form);
  },
};
