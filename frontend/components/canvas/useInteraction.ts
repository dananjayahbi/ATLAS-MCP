"use client";

/**
 * Doc 07 §7.1 / §2.2 — routes pointer events into `pointer-sessions`.
 *
 * Every handler mutates the scene ref and marks a layer; nothing here calls
 * `setState`, so a 240 Hz pointer stream cannot thrash React.
 */
import { useCallback, useRef } from "react";
import { hitTest, hitTolerance, toImageSpace } from "@/lib/canvas/geometry";
import type { EditorTool } from "@/lib/canvas/tools";
import type { Point, Stroke, StrokeStyle } from "@/lib/canvas/types";
import {
  beginPointerSession,
  cancelSession,
  modsOf,
  type PointerContext,
  type Session,
} from "./pointer-sessions";
import { endPointerSession, movePointerSession } from "./pointer-sessions-end";
import type { Scene } from "./scene";

export interface InteractionDeps {
  sceneRef: { current: Scene };
  measure: (text: string, font: string) => number;
  tool: EditorTool;
  style: StrokeStyle;
  blurMode: "pixelate" | "blur";
  blurStrength: number;
  reviewMode: boolean;
  invalidate: (layer?: "base" | "ink" | "overlay" | "all") => void;
  commitStroke: (stroke: Stroke) => void;
  deleteStrokes: (ids: string[]) => void;
  replaceStrokes: (pairs: Array<{ prev: Stroke; next: Stroke }>) => void;
  requestText: (anchor: Point, box: Point) => void;
  announce: (message: string) => void;
  onSelect: (ids: string[]) => void;
  restoreDoc: () => void;
}

export interface InteractionApi {
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: () => void;
  cancel: () => void;
}

export function useInteraction(deps: InteractionDeps): InteractionApi {
  const sessionRef = useRef<Session | null>(null);

  const context = useCallback(
    (): PointerContext => ({
      scene: deps.sceneRef.current,
      tool: deps.tool,
      style: deps.style,
      blurMode: deps.blurMode,
      blurStrength: deps.blurStrength,
      reviewMode: deps.reviewMode,
      measure: deps.measure,
      invalidate: deps.invalidate,
      commitStroke: deps.commitStroke,
      deleteStrokes: deps.deleteStrokes,
      replaceStrokes: deps.replaceStrokes,
      requestText: deps.requestText,
      announce: deps.announce,
      onSelect: deps.onSelect,
    }),
    [deps],
  );

  const localPoint = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): { image: Point; css: Point } => {
      const rect = event.currentTarget.getBoundingClientRect();
      const css = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      return { image: toImageSpace(css, deps.sceneRef.current.view), css };
    },
    [deps.sceneRef],
  );

  const cancel = useCallback(() => {
    sessionRef.current = null;
    cancelSession(context(), deps.restoreDoc);
  }, [context, deps.restoreDoc]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const ctx = context();
      if (ctx.scene.imageStatus !== "ready" || ctx.reviewMode) return;
      const { image, css } = localPoint(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      sessionRef.current = beginPointerSession(ctx, image, {
        clientX: event.clientX,
        clientY: event.clientY,
        cssLocal: css,
        mods: modsOf(event),
      });
      ctx.invalidate("overlay");
    },
    [context, localPoint],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const ctx = context();
      const { image, css } = localPoint(event);
      ctx.scene.cursor = css;
      const session = sessionRef.current;
      if (!session) {
        if (ctx.tool === "select" && ctx.scene.imageStatus === "ready" && !ctx.reviewMode) {
          const hit = hitTest(image, ctx.scene.doc, {
            tolerance: hitTolerance(ctx.scene.view, ctx.style.width),
            measure: ctx.measure,
            interior: event.altKey,
          });
          ctx.scene.hoveredId = hit?.id ?? null;
          ctx.invalidate("overlay");
        }
        return;
      }
      movePointerSession(ctx, session, image, {
        clientX: event.clientX,
        clientY: event.clientY,
        cssLocal: css,
        mods: modsOf(event),
      });
    },
    [context, localPoint],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const ctx = context();
      ctx.scene.pointerDown = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const session = sessionRef.current;
      sessionRef.current = null;
      if (!session) {
        ctx.invalidate("overlay");
        return;
      }
      endPointerSession(ctx, session, localPoint(event).image, modsOf(event));
      ctx.invalidate("all");
    },
    [context, localPoint],
  );

  const onPointerCancel = useCallback(() => cancel(), [cancel]);

  const onPointerLeave = useCallback(() => {
    const scene = deps.sceneRef.current;
    if (scene.cursor === null) return;
    scene.cursor = null;
    deps.invalidate("overlay");
  }, [deps]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, cancel };
}
