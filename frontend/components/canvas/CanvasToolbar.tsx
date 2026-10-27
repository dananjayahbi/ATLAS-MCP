"use client";

/**
 * Doc 07 §4.0 / §9.6 — the chrome row: identity, state, zoom, export.
 *
 * In `mode="review"` the export button is hidden entirely (§1.3) and every
 * mutating control is disabled. Export is disabled while the document is both
 * empty and clean.
 */
import type { AssetDTO } from "@/lib/types/enums";
import type { Size } from "@/lib/canvas/types";
import { useEngine } from "./engine-context";

export interface CanvasToolbarProps {
  taskId: string;
  sourceAsset: AssetDTO;
  imageSize: Size | null;
  strokeCount: number;
  dirty: boolean;
  busy: boolean;
  reviewMode: boolean;
  exportedPath: string | null;
}

const shortTask = (taskId: string): string => (taskId.length > 8 ? taskId.slice(0, 8) : taskId);

export function CanvasToolbar(props: CanvasToolbarProps) {
  const engine = useEngine();
  const exportDisabled = props.reviewMode || props.busy || (props.strokeCount === 0 && !props.dirty);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5"
      style={{ borderColor: "var(--border-grid)", background: "var(--surface-panel)" }}
    >
      <span
        className="font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)] tracking-[0.08em]"
        style={{ color: "var(--color-flow)" }}
      >
        ◤ {props.reviewMode ? "REVIEW" : "ANNOTATE"}
      </span>
      <span
        className="font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)]"
        style={{ color: "var(--text-muted)" }}
      >
        TASK {shortTask(props.taskId)}
      </span>
      <span
        className="truncate font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)]"
        style={{ color: "var(--text-secondary)", maxWidth: "15rem" }}
        title={props.sourceAsset.filename}
      >
        {props.sourceAsset.filename}
      </span>
      {props.imageSize ? (
        <span
          className="font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)]"
          style={{ color: "var(--text-machine)" }}
        >
          {props.imageSize.w} × {props.imageSize.h}
        </span>
      ) : null}
      <span
        className="font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)]"
        style={{ color: "var(--text-muted)" }}
      >
        {props.strokeCount} ANNOTATION{props.strokeCount === 1 ? "" : "S"}
        {props.dirty ? " · UNSAVED" : ""}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <div className="flex items-center gap-0.5" role="group" aria-label="Zoom">
          <ChromeButton label="Zoom out" onClick={engine.view.zoomOut} />
          <span
            className="min-w-[3.2rem] text-center font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)]"
            style={{ color: "var(--text-machine)" }}
            data-testid="canvas-zoom"
          >
            {engine.zoomPercent}%
          </span>
          <ChromeButton label="Zoom in" onClick={engine.view.zoomIn} />
          <ChromeButton label="Fit" onClick={engine.view.reset} />
        </div>

        {props.exportedPath ? (
          <ChromeButton
            label="Copy path"
            onClick={() => {
              void engine.copyPath();
            }}
          />
        ) : null}

        {props.reviewMode ? null : (
          <button
            type="button"
            onClick={() => {
              void engine.exportPng();
            }}
            disabled={exportDisabled}
            aria-busy={props.busy}
            aria-label="Export annotation as PNG and upload"
            data-testid="canvas-export"
            className="rounded-[var(--radius-hud)] border px-2 py-1 font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)] tracking-[0.08em] disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: "var(--color-flow)",
              background: props.busy ? "var(--surface-inset)" : "var(--color-flow-tint)",
              color: "var(--text-machine)",
            }}
          >
            {props.busy ? "EXPORTING…" : "EXPORT PNG"}
          </button>
        )}
      </div>
    </div>
  );
}

function ChromeButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
      className="rounded-[var(--radius-hud)] border px-1.5 py-0.5 font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)]"
      style={{
        borderColor: "var(--border-grid)",
        background: "var(--surface-raised)",
        color: "var(--text-secondary)",
      }}
    >
      {props.label}
    </button>
  );
}

export default CanvasToolbar;
