"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/format/cn";
import { assetsApi } from "@/lib/api/assets";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useDeleteAsset } from "@/lib/api/queries";
import { useAttachmentUpload } from "@/hooks/use-attachment-upload";
import { toast } from "@/hooks/use-toast";
import { formatBytes } from "@/lib/format/bytes";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadDropzone } from "@/components/tasks/upload-dropzone";

/**
 * Image management inside the task editor.
 *
 * The task detail sidebar can add screenshots but not remove them, and the
 * editor is where an operator fixes a task's evidence — so this lists every
 * image already on the task, lets each one be removed, and accepts new uploads.
 * Removal is optimistic in the sense that the row disappears immediately; the
 * mutation re-invalidates the board's thumbnail index on settle.
 */

const IMAGE_MIME = "image/";

export type TaskAssetsEditorProps = {
  taskId: string;
  projectSlug: string;
  /** Locks the whole section for evidence-bearing statuses. */
  disabled?: boolean;
  onChanged?: () => void;
};

export function TaskAssetsEditor({ taskId, projectSlug, disabled = false, onChanged }: TaskAssetsEditorProps) {
  const remove = useDeleteAsset();
  const uploads = useAttachmentUpload();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // `taskId` narrows the preview read so the editor sees every image, not the
  // board's 3-up sample.
  const images = useQuery({
    queryKey: [...qk.assets.byTask(taskId), projectSlug],
    queryFn: ({ signal }) => assetsApi.previews(projectSlug, signal, taskId),
    staleTime: 5_000,
  });

  useEffect(() => {
    setFiles([]);
    setError(null);
    setPendingDelete(null);
  }, [taskId]);

  const rows = (images.data?.items ?? [])
    .flatMap((entry) => entry.images)
    .filter((image) => image.mime_type.startsWith(IMAGE_MIME));

  const doDelete = async (assetId: string, filename: string) => {
    setPendingDelete(assetId);
    setError(null);
    try {
      await remove.mutateAsync({ id: assetId });
      toast({ level: "warn", title: `Image removed: ${filename}` });
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPendingDelete(null);
    }
  };

  const doUpload = async () => {
    setError(null);
    const result = await uploads.upload(taskId, files, "INPUT_SCREENSHOT");
    if (result.done > 0) {
      toast({ level: "info", title: `${result.done} image${result.done === 1 ? "" : "s"} added` });
      setFiles([]);
      void images.refetch();
      onChanged?.();
    }
    if (result.failed.length > 0) setError(result.failed.join(" · "));
  };

  return (
    <section className="flex min-w-0 flex-col gap-1.5" aria-label="Task images">
      <div className="flex items-baseline gap-2">
        <h4 className="text-hud-micro uppercase tracking-[0.08em] text-secondary">Images</h4>
        <span className="font-machine text-hud-micro tabular-nums text-disabled">{rows.length}</span>
        <span className="min-w-0 flex-1" />
        {images.isFetching ? (
          <span className="font-machine text-hud-micro uppercase text-disabled">syncing</span>
        ) : null}
      </div>

      {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}

      {images.isLoading && rows.length === 0 ? <Skeleton lines={2} /> : null}

      {!images.isLoading && rows.length === 0 ? (
        <p className="text-hud-micro text-disabled">No images attached yet.</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
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
                  className="h-20 w-full object-cover"
                />
                <div className="flex items-center gap-1 px-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate font-machine text-hud-micro text-secondary" title={image.filename}>
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
