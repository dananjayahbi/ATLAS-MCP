import Link from "next/link";
import { cn } from "@/lib/format/cn";
import { basename, middlePath } from "@/lib/format/path";
import type { AssetKind } from "@/lib/types/enums";
import type { AssetDTO } from "@/lib/types/enums";

/** Doc 06 §7.2 row 3 — attachment chips; images open in the canvas, others link out. */

const KIND_GLYPH: Record<AssetKind, string> = {
  INPUT_SCREENSHOT: "▣",
  ANNOTATED_CANVAS: "✎",
  USER_CONTEXT: "▤",
  OUTPUT_PATCH: "±",
  VERIFICATION_IMAGE: "◫",
  TEST_LOG: "≣",
};

const IMAGE_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>([
  "INPUT_SCREENSHOT",
  "ANNOTATED_CANVAS",
  "VERIFICATION_IMAGE",
]);

export function isImageAsset(asset: AssetDTO): boolean {
  return IMAGE_KINDS.has(asset.kind) && asset.mime_type.startsWith("image/");
}

export type AttachmentChipsProps = {
  assets: AssetDTO[];
  onOpenCanvas?: (asset: AssetDTO) => void;
  className?: string;
};

export function AttachmentChips({ assets, onOpenCanvas, className }: AttachmentChipsProps) {
  if (assets.length === 0) {
    return <p className={cn("shrink-0 text-hud-micro uppercase text-disabled", className)}>No attachments</p>;
  }

  return (
    <ul className={cn("flex shrink-0 flex-wrap items-center gap-1", className)} aria-label="Attachments">
      {assets.map((asset) => {
        const label = `${KIND_GLYPH[asset.kind]} ${basename(asset.filename)}`;
        const title = `${asset.kind} · ${middlePath(asset.absolute_path, 48)} · ${(asset.byte_size / 1024).toFixed(0)} kB`;
        const base =
          "inline-flex max-w-44 items-center gap-1 rounded-chip border border-grid bg-inset px-1.5 py-0.5 font-machine text-hud-micro text-secondary transition-colors duration-100 hover:border-grid-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow";
        return (
          <li key={asset.id} className="min-w-0">
            {isImageAsset(asset) && onOpenCanvas ? (
              <button type="button" onClick={() => onOpenCanvas(asset)} title={title} className={base}>
                <span className="truncate">{label}</span>
              </button>
            ) : (
              <Link href={asset.url} target="_blank" rel="noreferrer" title={title} className={base}>
                <span className="truncate">{label}</span>
                <span aria-hidden className="shrink-0 text-disabled">
                  ↗
                </span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
