"use client";

import dynamic from "next/dynamic";
import type { CanvasError } from "@/lib/canvas/errors";
import type { AssetDTO } from "@/lib/types/enums";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/**
 * Doc 06 §7.6 — the review-grade annotation surface, in its own module so the
 * heavy canvas engine is only fetched when an operator actually opens it.
 *
 * The quick markup editor (pen + eraser + pan/zoom) is the default surface;
 * this is the full Doc 07 engine, reachable when an operator needs callouts,
 * blur or a legend on evidence.
 */

const AnnotationCanvas = dynamic(() => import("@/components/canvas/AnnotationCanvas"), { ssr: false });

export type AnnotationCanvasModalProps = {
  taskId: string;
  asset: AssetDTO;
  locked: boolean;
  onClose: () => void;
  onError: (message: string | null) => void;
};

export function AnnotationCanvasModal({
  taskId,
  asset,
  locked,
  onClose,
  onError,
}: AnnotationCanvasModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Annotation canvas"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-scrim)] p-6"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-hud border border-grid-strong bg-panel p-3">
        <div className="flex shrink-0 items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-hud-label uppercase tracking-[0.06em] text-primary">
            {asset.filename}
          </h2>
          <Button size="sm" onClick={onClose}>
            Close <Kbd size="xs">Esc</Kbd>
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <AnnotationCanvas
            taskId={taskId}
            sourceAsset={asset}
            mode={locked ? "review" : "create"}
            className="h-full min-h-[60vh]"
            onExport={() => onClose()}
            onError={(error: CanvasError) => onError(error.message)}
          />
        </div>
      </div>
    </div>
  );
}
