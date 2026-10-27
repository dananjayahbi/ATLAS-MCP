"use client";

/**
 * Doc 07 §2.1 — the three stacked canvases plus the transient DOM layers
 * (text editor, review banner, restore prompt).
 *
 * Only `overlay` accepts pointer events; `base` and `ink` are inert so all
 * hit-testing happens in one place (§2.1).
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEngine } from "./engine-context";
import { RestorePrompt } from "./RestorePrompt";
import { ReviewBanner } from "./ReviewBanner";
import { TextEditor } from "./TextEditor";

export interface CanvasViewportProps {
  reviewMode: boolean;
  sourceFilename: string;
}

export function CanvasViewport({ reviewMode, sourceFilename }: CanvasViewportProps) {
  const engine = useEngine();
  const { renderer, interaction, keyboard, view } = engine;

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={renderer.wrapperRef}
        role="application"
        tabIndex={0}
        aria-label={`Annotation canvas for source ${sourceFilename}`}
        aria-describedby="canvas-keyboard-help"
        onKeyDown={keyboard.onKeyDown}
        onKeyUp={keyboard.onKeyUp}
        className="absolute inset-0 overflow-hidden rounded-[var(--radius-hud)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          background: "var(--surface-canvas)",
          outlineColor: "var(--border-focus)",
          cursor: engine.cursorStyle,
        }}
        data-testid="canvas-wrapper"
      >
        <canvas
          ref={renderer.baseRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          data-layer="base"
        />
        <canvas
          ref={renderer.inkRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          data-layer="ink"
        />
        <canvas
          ref={renderer.overlayRef}
          className="absolute inset-0 touch-none"
          data-layer="overlay"
          data-testid="canvas-overlay"
          onPointerDown={(event: ReactPointerEvent<HTMLCanvasElement>) => {
            if (view.onPointerDown(event)) return;
            interaction.onPointerDown(event);
          }}
          onPointerMove={(event: ReactPointerEvent<HTMLCanvasElement>) => {
            if (view.onPointerMove(event)) return;
            interaction.onPointerMove(event);
          }}
          onPointerUp={(event: ReactPointerEvent<HTMLCanvasElement>) => {
            interaction.onPointerUp(event);
            view.onPointerUp(event);
          }}
          onPointerCancel={interaction.onPointerCancel}
          onPointerLeave={interaction.onPointerLeave}
        />

        {reviewMode ? <ReviewBanner /> : null}

        {engine.restored && !reviewMode ? (
          <RestorePrompt
            stale={engine.restored.stale}
            savedAt={engine.restored.savedAt}
            strokeCount={engine.restored.doc?.strokes.length ?? 0}
            onRestore={engine.restoreDraft}
            onDiscard={engine.discardDraft}
            onViewJson={engine.viewJson}
          />
        ) : null}

        {engine.textDraft && !reviewMode ? (
          <TextEditor
            anchor={engine.textDraft.anchor}
            box={engine.textDraft.box}
            view={engine.sceneRef.current.view}
            initialValue={engine.textDraft.value}
            onCommit={engine.commitText}
            onCancel={engine.cancelText}
          />
        ) : null}
      </div>
    </div>
  );
}

export default CanvasViewport;
