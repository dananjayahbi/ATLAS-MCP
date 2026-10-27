"use client";

/**
 * Doc 07 §12.2 — the screen-reader surface.
 *
 * One coalesced polite live region for routine state, one assertive region for
 * failures, plus a hidden stroke list so the document is inspectable without
 * pixels. Nothing here is drawn on a canvas.
 */
import type { Stroke } from "@/lib/canvas/types";
import { describeStroke } from "./describe";

export interface CanvasA11yLayerProps {
  /** Polite announcement (tool changes, commits, undo). */
  announcement: string;
  /** Assertive announcement (export/upload failures), or `null`. */
  alert: string | null;
  strokes: Stroke[];
  toolLabel: string;
  selectionSize: number;
  busy: boolean;
}

export function CanvasA11yLayer({
  announcement,
  alert,
  strokes,
  toolLabel,
  selectionSize,
  busy,
}: CanvasA11yLayerProps) {
  return (
    <div className="sr-only" aria-live="off">
      <p data-testid="canvas-tool-state">
        {toolLabel}. {selectionSize > 0 ? `${selectionSize} annotation(s) selected.` : "Nothing selected."}
        {busy ? " Export in progress." : ""}
      </p>
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="canvas-status">
        {announcement}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" data-testid="canvas-alert">
        {alert ?? ""}
      </div>
      <ul aria-label="Annotations" data-testid="canvas-stroke-list">
        {strokes.map((stroke) => (
          <li key={stroke.id}>{describeStroke(stroke)}</li>
        ))}
      </ul>
    </div>
  );
}

export default CanvasA11yLayer;
