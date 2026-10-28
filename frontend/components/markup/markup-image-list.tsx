"use client";

import { cn } from "@/lib/format/cn";
import { formatBytes } from "@/lib/format/bytes";
import { assetsApi } from "@/lib/api/assets";

/** Right-hand image list of the markup modal. */

export type MarkupImageEntry = {
  id: string;
  label: string;
  url: string;
  mimeType?: string;
  byteSize?: number;
  kind?: string;
  annotated?: boolean;
  /** Content hash, so the modal repaints after a burn-in rewrites the bytes. */
  version?: string;
};

export type MarkupImageListProps = {
  images: readonly MarkupImageEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Task attachments created by a previous save, if any. */
  className?: string;
};

export function MarkupImageList({ images, activeId, onSelect, className }: MarkupImageListProps) {
  return (
    <aside
      aria-label="Images on this task"
      className={cn("flex w-56 shrink-0 flex-col border-r border-grid bg-panel/60", className)}
    >
      <h3 className="border-b border-grid px-2 py-1 text-hud-micro uppercase tracking-[0.08em] text-secondary">
        Images <span className="font-machine tabular-nums text-disabled">({images.length})</span>
      </h3>

      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {images.map((image) => {
          const active = image.id === activeId;
          return (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => onSelect(image.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "group flex w-full min-w-0 items-center gap-2 rounded-hud border p-1 text-left transition-colors duration-100",
                  active
                    ? "border-flow/60 bg-flow-tint/50"
                    : "border-transparent hover:border-grid hover:bg-inset",
                )}
              >
                {/* Plain <img>: the source is a same-origin API route that next/image cannot optimise. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={assetsApi.contentUrl(image.id, image.version)}
                  alt=""
                  loading="lazy"
                  className="size-12 shrink-0 rounded-chip border border-grid object-cover"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="min-w-0 truncate font-machine text-machine-sm text-primary">
                    {image.label}
                  </span>
                  <span className="min-w-0 truncate text-hud-micro text-muted">
                    {image.kind ?? image.mimeType}
                    {image.annotated ? " · marked" : ""}
                  </span>
                  {typeof image.byteSize === "number" ? (
                    <span className="font-machine text-hud-micro text-disabled">
                      {formatBytes(image.byteSize)}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="border-t border-grid px-2 py-1 text-hud-micro text-disabled">
        Markup is burned onto the selected image only. Other images stay untouched.
      </p>
    </aside>
  );
}
