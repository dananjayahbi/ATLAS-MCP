import type { AssetDTO } from "@/lib/types/enums";
import type { AssetKind } from "@/lib/types/enums";
import { apiDelete, apiGet, apiUpload } from "./client";

/**
 * Doc 01 §12 / Doc 06 §3.2 — assets are rendered by URL only, never fetched into
 * JS memory (§15). `TaskDetailDTO.assets[]` remains the single source of asset
 * lists for one task; `previews()` is the board's batched thumbnail read so a
 * card never needs a detail request of its own.
 */

/** A card-sized subset of `AssetDTO` — everything a thumbnail needs, nothing else. */
export type AssetPreview = {
  id: string;
  kind: AssetKind;
  filename: string;
  mime_type: string;
  url: string;
  thumbnail_url?: string | null;
  /** Content hash; the only cache-buster for burn-in, which keeps the id. */
  version?: string;
  /** Present on the task-scoped preview read (`?task_id=`). */
  byte_size?: number;
  created_at?: string;
};

export type TaskAssetPreview = {
  task_id: string;
  images: AssetPreview[];
  total: number;
};

/** Opaque to the API layer; `lib/canvas` owns the real document shape. */
export type CanvasDocumentPayload = Record<string, unknown>;

export type AnnotationReadResponse = {
  source_asset_id: string;
  document: CanvasDocumentPayload | null;
  annotated_asset: AssetDTO | null;
};

export type AnnotationWriteResponse = {
  asset: AssetDTO;
  source_asset: AssetDTO;
  replaced_source: boolean;
};

/**
 * Cache-busting image URL. Burn-in rewrites an asset's bytes under the same id,
 * so a URL that ignores `version` would keep showing the pre-markup pixels.
 */
export function assetContentUrl(assetId: string, version?: string | null): string {
  const base = `/api/v1/assets/${encodeURIComponent(assetId)}/content`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

export const assetsApi = {
  contentUrl: (assetId: string, version?: string | null): string => assetContentUrl(assetId, version),
  thumbnailUrl: (assetId: string, version?: string | null): string => {
    const base = `/api/v1/assets/${encodeURIComponent(assetId)}/thumbnail`;
    return version ? `${base}?v=${encodeURIComponent(version)}` : base;
  },
  downloadUrl: (assetId: string): string => `/api/v1/assets/${encodeURIComponent(assetId)}/download`,
  upload: (taskId: string, kind: AssetKind, file: File) => {
    const form = new FormData();
    form.set("task_id", taskId);
    form.set("kind", kind);
    form.set("file", file);
    return apiUpload<AssetDTO>("/assets/", form);
  },
  /** Removes one attachment, row and bytes. */
  remove: (assetId: string) => apiDelete<void>(`/assets/${encodeURIComponent(assetId)}/`),
  /**
   * Batched board thumbnails: 3 newest images per task plus the true total.
   * `taskId` widens the cap so the task editor can list every image on a task.
   */
  previews: (slug: string, signal?: AbortSignal, taskId?: string) =>
    apiGet<{ items: TaskAssetPreview[]; next_cursor: string | null }>(
      `/projects/${encodeURIComponent(slug)}/assets/${taskId ? `?task_id=${encodeURIComponent(taskId)}` : ""}`,
      { signal },
    ),
  annotation: (assetId: string, signal?: AbortSignal) =>
    apiGet<AnnotationReadResponse>(`/assets/${encodeURIComponent(assetId)}/annotation/`, { signal }),
  /**
   * Flatten-on-save: the PNG is the burn-in, `document` keeps the markup
   * editable, and `replaceSource` overwrites the original bytes in place.
   *
   * `replaceOnly` is the markup modal's "one edited image" contract: burn onto
   * the source and skip the extra `ANNOTATED_CANVAS` duplicate.
   */
  saveAnnotation: (
    assetId: string,
    file: Blob,
    document: CanvasDocumentPayload | null,
    replaceSource: boolean,
    replaceOnly = false,
  ) => {
    const form = new FormData();
    form.set("file", file, "annotated_canvas.png");
    if (document) form.set("document", JSON.stringify(document));
    if (replaceSource) form.set("replace_source", "1");
    if (replaceOnly) form.set("replace_only", "1");
    return apiUpload<AnnotationWriteResponse>(
      `/assets/${encodeURIComponent(assetId)}/annotation/`,
      form,
    );
  },
};
