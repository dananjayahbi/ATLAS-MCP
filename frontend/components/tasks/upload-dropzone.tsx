"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/format/cn";

/**
 * Doc 06 §7.2 / Doc 07 §9.4 — the attachment surface behind the composer and the
 * task editor. Drag, drop and click-to-pick all funnel into one `File[]`.
 *
 * The caller owns uploads; this component only validates and previews so a
 * failed POST never loses the operator's selection.
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES = 5;

export type UploadDropzoneProps = {
  /** Already-accepted files, owned by the caller. */
  files: readonly File[];
  onChange: (files: File[]) => void;
  accept?: string;
  maxFiles?: number;
  maxBytes?: number;
  disabled?: boolean;
  label?: string;
  hint?: string;
  className?: string;
};

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

export function UploadDropzone({
  files,
  onChange,
  accept = "image/png,image/jpeg,image/webp",
  maxFiles = MAX_IMAGES,
  maxBytes = MAX_IMAGE_BYTES,
  disabled = false,
  label = "Screenshots",
  hint = "Drop images here, or click to browse",
  className,
}: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Object URLs must be revoked or the blob outlives the dialog.
  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );

  useEffect(() => {
    return () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url);
    };
  }, [previews]);

  const accept_ = useCallback(
    (incoming: FileList | null) => {
      if (!incoming || incoming.length === 0) return;
      const next: File[] = [];
      let problem: string | null = null;

      for (const file of Array.from(incoming)) {
        if (!isImage(file)) {
          problem = `${file.name}: only PNG, JPEG or WebP images are supported.`;
          continue;
        }
        if (file.size > maxBytes) {
          problem = `${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the ${Math.round(
            maxBytes / 1024 / 1024,
          )} MB limit.`;
          continue;
        }
        next.push(file);
      }

      const merged = [...files];
      for (const file of next) {
        const duplicate = merged.some(
          (existing) => existing.name === file.name && existing.size === file.size,
        );
        if (!duplicate) merged.push(file);
      }
      if (merged.length > maxFiles) {
        problem = `At most ${maxFiles} images per task.`;
      }
      setError(problem);
      onChange(merged.slice(0, maxFiles));
    },
    [files, maxBytes, maxFiles, onChange],
  );

  const remove = (index: number) => {
    setError(null);
    onChange(files.filter((_, at) => at !== index));
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-hud-micro uppercase tracking-[0.08em] text-secondary">{label}</span>

      <div
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(false);
          accept_(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-hud border border-dashed p-3 text-center transition-colors duration-100",
          dragging ? "border-flow bg-flow-tint/40" : "border-grid bg-canvas",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={maxFiles > 1}
          disabled={disabled}
          onChange={(event) => {
            accept_(event.target.files);
            // Reset so re-picking the same file still fires `change`.
            event.target.value = "";
          }}
          className="sr-only"
          id="upload-dropzone-input"
          data-testid="upload-input"
        />
        <p className="text-hud-micro uppercase tracking-[0.06em] text-muted">{hint}</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="mt-1 rounded-chip border border-grid px-2 py-0.5 font-machine text-hud-micro uppercase text-secondary hover:border-grid-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow disabled:cursor-not-allowed"
        >
          Choose images
        </button>
        <p className="mt-1 font-machine text-hud-micro text-disabled">
          {files.length}/{maxFiles} · PNG/JPEG/WebP · max {Math.round(maxBytes / 1024 / 1024)} MB each
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-hud-micro text-critical-hot">
          {error}
        </p>
      ) : null}

      {previews.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label="Selected images">
          {previews.map((preview, index) => (
            <li key={`${preview.file.name}-${index}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob: URLs cannot use next/image */}
              <img
                src={preview.url}
                alt={preview.file.name}
                className="size-14 rounded-chip border border-grid object-cover"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={disabled}
                aria-label={`Remove ${preview.file.name}`}
                className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border border-grid-strong bg-panel font-machine text-hud-micro text-critical-hot hover:bg-critical-tint"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
