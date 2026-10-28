"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/format/cn";
import { assetsApi } from "@/lib/api/assets";
import { errorMessage } from "@/lib/api/errors";
import { useDeleteAsset } from "@/lib/api/queries";
import { useAttachmentUpload } from "@/hooks/use-attachment-upload";
import { toast } from "@/hooks/use-toast";
import { formatBytes } from "@/lib/format/bytes";
import type { AssetDTO } from "@/lib/types/enums";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/tasks/upload-dropzone";

/**
 * Image management for a pending discovery.
 *
 * A discovery is a task, so triage must be able to fix its evidence exactly like
 * the task editor does: remove a screenshot the agent attached by mistake, add
 * one the operator has. Uploads land through the same `/assets/` route as a
 * manual task, so the promoted task is indistinguishable from a hand-made one.
 */

const IMAGE_MIME = "image/";

export type DiscoveryAssetsEditorProps = {
  taskId: string;
  /** The post-edit `DiscoveryDTO` assets; refetched by the parent on change. */
  assets: readonly AssetDTO[];
  disabled?: boolean;
  onChanged?: () => void;
  className?: string;
};

export function DiscoveryAssetsEditor({
  taskId,
  assets,
  disabled = false,
  onChanged,
  className,
}: DiscoveryAssetsEditorProps) {
  const remove = useDeleteAsset();
  const uploads = useAttachmentUpload();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  /** Uploads add rows the parent's snapshot does not have yet. */
  const [added, setAdded] = useState<AssetDTO[]>([]);

  useEffect(() => {
    setFiles([]);
    setError(null);
    setPendingDelete(null);
    setAdded([]);
  }, [taskId]);

  // A refetch can land before this component unmounts, so newly uploaded rows
  // are reconciled against the authoritative list instead of being counted twice.
  const rows = [...assets, ...added.filter((extra) => !assets.some((known) => known.id === extra.id))].filter(
    (asset) => asset.mime_type.startsWith(IMAGE_MIME),
  );

  const doDelete = useCallback(
    async (assetId: string, filename: string) => {
      setPendingDelete(assetId);
      setError(null);
      try {
        await remove.mutateAsync({ id: assetId });
        setAdded((prev) => prev.filter((asset) => asset.id !== assetId));
        toast({ level: "warn", title: `Image removed: ${filename}` });
        onChanged?.();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setPendingDelete(null);
      }
    },
    [onChanged, remove],
  );

  const doUpload = async () => {
    setError(null);
    const result = await uploads.upload(taskId, files, "INPUT_SCREENSHOT");
    if (result.done > 0) {
      toast({ level: "info", title: `${result.done} image${result.done === 1 ? "" : "s"} added` });
      setFiles([]);
      onChanged?.();
    }
    if (result.failed.length > 0) setError(result.failed.join(" · "));
  };

  return (
    <section className={cn("flex min-w-0 flex-col gap-1.5", className)} aria-label="Discovery images">
      <div className="flex items-baseline gap-2">
        <h4 className="text-hud-micro uppercase tracking-[0.08em] text-secondary">Images</h4>
        <span className="font-machine text-hud-micro tabular-nums text-disabled">{rows.length}</span>
        <span className="min-w-0 flex-1" />
        {uploads.uploading ? (
          <span className="font-machine text-hud-micro uppercase text-disabled">uploading</span>
        ) : null}
      </div>

      {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}

      {rows.length === 0 ? <p className="text-hud-micro text-disabled">No images attached.</p> : null}

      {rows.length > 0 ? (
        <ul className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
          {rows.map((image) => {
            const busy = pendingDelete === image.id;
            return (
              <li
                key={image.id}
                className={cn(
                  "group/img relative min-w-0 overflow-hidden rounded-chip border border-grid bg-inset",
                  busy && "opacity-50",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- same-origin API route */}
                <img
                  src={assetsApi.contentUrl(image.id, image.version)}
                  alt={image.filename}
                  loading="lazy"
                  className="h-16 w-full object-cover"
                />
                <div className="flex items-center gap-1 px-1 py-0.5">
                  <span
                    className="min-w-0 flex-1 truncate font-machine text-hud-micro text-secondary"
                    title={image.filename}
                  >
                    {image.filename}
                  </span>
                  {typeof image.byte_size === "number" ? (
                    <span className="shrink-0 font-machine text-hud-micro text-disabled">
                      {formatBytes(image.byte_size)}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={disabled || busy || remove.isPending}
                  onClick={() => void doDelete(image.id, image.filename)}
                  aria-label={`Remove ${image.filename}`}
                  title="Remove image"
                  className="absolute right-1 top-1 grid size-5 place-items-center rounded-chip border border-critical/50 bg-canvas/85 font-machine text-hud-micro text-critical-hot hover:bg-critical-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "…" : "×"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <UploadDropzone
        files={files}
        onChange={setFiles}
        disabled={disabled || uploads.uploading}
        label="Add images"
        hint="Drop screenshots to attach, or click to browse"
      />

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="primary"
          onClick={() => void doUpload()}
          loading={uploads.uploading}
          disabled={disabled || files.length === 0}
        >
          Upload {files.length > 0 ? `(${files.length})` : ""}
        </Button>
        {uploads.progress ? (
          <span className="font-machine text-hud-micro tabular-nums text-muted">
            {uploads.progress.done}/{uploads.progress.total}
          </span>
        ) : null}
      </div>
    </section>
  );
}
