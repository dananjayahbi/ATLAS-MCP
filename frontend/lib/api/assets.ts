import type { AssetDTO } from "@/lib/types/enums";
import type { AssetKind } from "@/lib/types/enums";
import { apiGet, apiUpload } from "./client";

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
  /** Batched board thumbnails: 3 newest images per task plus the true total. */
  previews: (slug: string, signal?: AbortSignal) =>
    apiGet<{ items: TaskAssetPreview[]; next_cursor: string | null }>(
      `/projects/${encodeURIComponent(slug)}/assets/`,
      { signal },
    ),
  annotation: (assetId: string, signal?: AbortSignal) =>
    apiGet<AnnotationReadResponse>(`/assets/${encodeURIComponent(assetId)}/annotation/`, { signal }),
  /**
   * Flatten-on-save: the PNG is the burn-in, `document` keeps the markup
   * editable, and `replaceSource` overwrites the original bytes in place.
   */
  saveAnnotation: (
    assetId: string,
    file: Blob,
    document: CanvasDocumentPayload | null,
    replaceSource: boolean,
  ) => {
    const form = new FormData();
    form.set("file", file, "annotated_canvas.png");
    if (document) form.set("document", JSON.stringify(document));
    if (replaceSource) form.set("replace_source", "1");
    return apiUpload<AnnotationWriteResponse>(
      `/assets/${encodeURIComponent(assetId)}/annotation/`,
      form,
    );
  },
};
