"use client";

/**
 * Doc 07 §1.3 — the published component.
 *
 * `AnnotationCanvasProps`, `ExportResult` and the default export are a FROZEN
 * contract for Doc 06. Everything below is composition: one engine hook for
 * state and side effects, one renderer hook for the three stacked canvases.
 */
import { useEffect, useRef } from "react";
import type { AssetDTO } from "@/lib/types/enums";
import type { CanvasError } from "@/lib/canvas/errors";
import type { CanvasDocument, ExportResult } from "@/lib/canvas/types";
import { CanvasA11yLayer } from "./CanvasA11yLayer";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasViewport } from "./CanvasViewport";
import { ChromeColumn } from "./ChromeColumn";
import { CanvasEngineProvider } from "./engine-context";
import { useCanvasEngine } from "./useCanvasEngine";

export type { ExportResult } from "@/lib/canvas/types";
export type { CanvasDocument } from "@/lib/canvas/types";

/** §1.3 — FROZEN. Do not add, remove or retype a member. */
export interface AnnotationCanvasProps {
  /** UUID; keys autosave + upload. */
  taskId: string;
  /** `kind === "INPUT_SCREENSHOT"`; fetched via `createImageBitmap`. */
  sourceAsset: AssetDTO;
  /** Re-open an existing ANNOTATED_CANVAS. */
  initialDocument?: CanvasDocument;
  /** `"review"` = read-only, no tools, no export. */
  mode?: "create" | "review";
  /** Fires after a 2xx asset POST. */
  onExport?: (result: ExportResult) => void;
  /** §14 taxonomy; never throws. */
  onError?: (err: CanvasError) => void;
  /** Doc 06 routes its unsaved-changes guard through this. */
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
}

export function AnnotationCanvas(props: AnnotationCanvasProps) {
  const reviewMode = props.mode === "review";
  const engine = useCanvasEngine({
    taskId: props.taskId,
    sourceAssetId: props.sourceAsset.id,
    sourceUrl: props.sourceAsset.url,
    initialDocument: props.initialDocument,
    reviewMode,
    onExport: props.onExport,
    onError: props.onError,
    onDirtyChange: props.onDirtyChange,
  });

  const dirtyRef = useRef(props.onDirtyChange);
  useEffect(() => {
    dirtyRef.current = props.onDirtyChange;
    dirtyRef.current?.(engine.dirty);
  }, [engine.dirty, props.onDirtyChange]);

  const className = ["flex min-h-0 min-w-0 flex-col", props.className ?? ""].join(" ").trim();

  return (
    <CanvasEngineProvider value={engine}>
      <div
        className={className}
        data-testid="annotation-canvas"
        data-task-id={props.taskId}
        data-mode={reviewMode ? "review" : "create"}
      >
        <CanvasToolbar
          taskId={props.taskId}
          sourceAsset={props.sourceAsset}
          imageSize={engine.doc.imageNaturalSize.w > 1 ? engine.doc.imageNaturalSize : null}
          strokeCount={engine.doc.strokes.length}
          dirty={engine.dirty}
          busy={engine.busy}
          reviewMode={reviewMode}
          exportedPath={engine.exportedPath}
        />
        <div className="flex min-h-0 flex-1 gap-2 p-2">
          <ChromeColumn reviewMode={reviewMode} />
          <CanvasViewport reviewMode={reviewMode} sourceFilename={props.sourceAsset.filename} />
        </div>
        <CanvasA11yLayer
          announcement={engine.announcement}
          alert={engine.alert}
          strokes={engine.doc.strokes}
          toolLabel={engine.toolLabel}
          selectionSize={engine.selectionIds.length}
          busy={engine.busy}
        />
        <p id="canvas-keyboard-help" className="sr-only">
          Press 1 to 6 or a tool letter to choose a tool. Enter places a region at the keyboard cursor,
          arrows move or size it, Enter commits, Escape cancels. Control Z undoes, Control Shift Z redoes.
          Bracket keys change stroke width. Plus, minus and zero zoom.
        </p>
      </div>
    </CanvasEngineProvider>
  );
}

export default AnnotationCanvas;
