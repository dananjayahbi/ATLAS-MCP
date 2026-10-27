"use client";

/**
 * Doc 07 §7.5 / §7.6 — in-flight transform projection.
 *
 * A move/resize gesture mutates the *scene projection* on every pointer move so
 * the ink layer follows the pointer, then commits one history command on
 * pointerup (§8.3). These helpers stay separate from the session machine so the
 * session file reads as a state machine only.
 */
import type { Stroke } from "@/lib/canvas/types";
import type { Scene } from "./scene";

export function translateBy(stroke: Stroke, dx: number, dy: number): Stroke {
  switch (stroke.tool) {
    case "rect":
    case "highlight":
    case "blur":
      return { ...stroke, rect: { ...stroke.rect, x: stroke.rect.x + dx, y: stroke.rect.y + dy } };
    case "arrow":
    case "line":
      return {
        ...stroke,
        from: { x: stroke.from.x + dx, y: stroke.from.y + dy },
        to: { x: stroke.to.x + dx, y: stroke.to.y + dy },
      };
    case "freehand":
      return { ...stroke, points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case "text":
      return {
        ...stroke,
        anchor: { x: stroke.anchor.x + dx, y: stroke.anchor.y + dy },
        box: { x: stroke.box.x + dx, y: stroke.box.y + dy },
      };
    default:
      return stroke;
  }
}

/** Projects a transform into the scene without touching history. */
export function applyPreviewDoc(
  scene: Scene,
  moves: Array<{ prev: Stroke; next: Stroke }>,
): void {
  const byId = new Map(moves.map((m) => [m.prev.id, m.next]));
  scene.doc = {
    ...scene.doc,
    strokes: scene.doc.strokes.map((stroke) => byId.get(stroke.id) ?? stroke),
  };
}

export function normalisePreview(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}
