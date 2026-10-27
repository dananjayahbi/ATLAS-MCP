import type { AssetDTO } from "@/lib/types/enums";
import type { AssetKind } from "@/lib/types/enums";
import { apiUpload } from "./client";

/**
 * Doc 01 §12 / Doc 06 §3.2 — assets are rendered by URL only, never fetched into
 * JS memory (§15). `TaskDetailDTO.assets[]` is the single source of asset lists,
 * so there is deliberately no list call here.
 */

export const assetsApi = {
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
