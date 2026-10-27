"use client";

/**
 * Doc 07 §7.4 / §7.6 — the pointer gesture move + commit half.
 *
 * Previews mutate only the scene projection; the single history command is
 * pushed on pointerup (§8.3), so a 240 Hz stream never touches the reducer.
 */
import { commitDrag, commitInk, dragPreview, extendInk, marqueeSelection, previewStrokeFor, updateDrag, type DragModifiers } from "@/lib/canvas/interaction";
import type { Point } from "@/lib/canvas/types";
import { resizeRectByHandle, scaleStrokeInBBox } from "./pointer-resize";
import type { PointerContext, Session } from "./pointer-sessions";
import { applyPreviewDoc, normalisePreview, translateBy } from "./pointer-transform";

export interface PointerMoveInput {
  clientX: number;
  clientY: number;
  cssLocal: Point;
  mods: DragModifiers;
}

export function movePointerSession(
  ctx: PointerContext,
  session: Session,
  point: Point,
  input: PointerMoveInput,
): void {
  const { scene } = ctx;
  switch (session.kind) {
    case "drag": {
      const cssDistance = Math.hypot(
        input.clientX - session.cssOrigin.x,
        input.clientY - session.cssOrigin.y,
      );
      session.state = updateDrag(session.state, point, cssDistance, input.mods);
      const preview = dragPreview(session.state);
      const nextBlur = preview.rect && session.state.tool === "blur" ? preview.rect : null;
      scene.previewBlur = nextBlur;
      scene.previewStroke = previewStrokeFor(session.state, preview);
      ctx.invalidate("overlay");
      if (nextBlur) ctx.invalidate("base");
      return;
    }
    case "ink": {
      session.state = extendInk(session.state, point, input.mods);
      scene.previewStroke = {
        id: "preview-ink",
        tool: "freehand",
        style: session.state.style,
        createdAt: 0,
        points: session.state.points,
      };
      ctx.invalidate("overlay");
      return;
    }
    case "move": {
      const dx = point.x - session.origin.x;
      const dy = point.y - session.origin.y;
      session.moves = session.moves.map((m) => ({ prev: m.prev, next: translateBy(m.prev, dx, dy) }));
      applyPreviewDoc(scene, session.moves);
      ctx.invalidate("ink");
      return;
    }
    case "resize": {
      const delta = { x: point.x - session.origin.x, y: point.y - session.origin.y };
      const next = resizeRectByHandle(session.bbox, session.handle, delta, input.mods);
      session.members = session.members.map((m) => ({
        prev: m.prev,
        next: scaleStrokeInBBox(m.prev, session.bbox, next),
      }));
      applyPreviewDoc(scene, session.members);
      ctx.invalidate("ink");
      return;
    }
    case "marquee": {
      scene.marquee = normalisePreview(session.origin, point);
      ctx.invalidate("overlay");
      return;
    }
    default:
      return;
  }
}

export function endPointerSession(
  ctx: PointerContext,
  session: Session,
  point: Point,
  mods: DragModifiers,
): void {
  const { scene } = ctx;
  switch (session.kind) {
    case "drag": {
      const stroke = commitDrag(session.state, {
        doc: scene.doc,
        modifiersAtCommit: mods,
        altAtStart: session.altAtStart,
      });
      scene.previewStroke = null;
      scene.previewBlur = null;
      ctx.invalidate("base");
      if (stroke) ctx.commitStroke(stroke);
      return;
    }
    case "ink": {
      const stroke = commitInk(session.state, scene.view.scale);
      scene.previewStroke = null;
      if (stroke) ctx.commitStroke(stroke);
      return;
    }
    case "move":
    case "resize": {
      const changes = session.kind === "move" ? session.moves : session.members;
      const changed = changes.filter((m) => m.prev !== m.next);
      if (changed.length > 0) ctx.replaceStrokes(changed);
      return;
    }
    case "marquee": {
      const band = normalisePreview(session.origin, point);
      scene.marquee = null;
      const ids = marqueeSelection(scene.doc, band, ctx.measure);
      ctx.onSelect(ids);
      if (ids.length > 0) ctx.announce(`${ids.length} annotation(s) selected.`);
      return;
    }
    default:
      return;
  }
}
