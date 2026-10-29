"use client";

import { cn } from "@/lib/format/cn";
import type { AssetPreview } from "@/lib/api/assets";
import { assetImageUrl } from "@/lib/format/asset-image";

/**
 * The dashboard thumbnail grid on a task card (Doc 06 §7.2 row 3).
 *
 * Thumbnails are `<img>` at a fixed 44 px square: they are same-origin API
 * routes, so `next/image` would add a proxy hop without any optimisation, and
 * the grid must stay clickable at 100 % zoom without layout shift.
 */

export type TaskThumbnailGridProps = {
  images: readonly AssetPreview[];
  total: number;
  onOpen?: (assetId: string) => void;
  className?: string;
};

const MAX_VISIBLE = 3;

export function TaskThumbnailGrid({ images, total, onOpen, className }: TaskThumbnailGridProps) {
  if (images.length === 0) return null;
  const overflow = total - images.length;

  return (
    <div className={cn("flex items-center gap-1", className)} aria-label={`${total} image attachments`}>
      {images.slice(0, MAX_VISIBLE).map((image) => (
        <button
          key={image.id}
          type="button"
          onClick={(event) => {
            // The card is a link target; a thumbnail click must not navigate.
            event.preventDefault();
            event.stopPropagation();
            onOpen?.(image.id);
          }}
          title={`${image.filename} — click to mark up`}
          aria-label={`Open ${image.filename} in the markup editor`}
          className="group/thumb relative size-11 shrink-0 overflow-hidden rounded-chip border border-grid bg-inset transition-colors duration-100 hover:border-flow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- same-origin API route, fixed box */}
          <img
            src={assetImageUrl(image)}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-150 group-hover/thumb:scale-105"
          />
          <span className="pointer-events-none absolute inset-0 grid place-items-center bg-canvas/60 opacity-0 transition-opacity duration-100 group-hover/thumb:opacity-100">
            <span aria-hidden className="font-machine text-hud-micro text-flow">
              ✎
            </span>
          </span>
        </button>
      ))}
      {overflow > 0 ? (
        <span
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip border border-grid bg-inset font-machine text-hud-micro tabular-nums text-muted"
          title={`${overflow} more image${overflow === 1 ? "" : "s"}`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
