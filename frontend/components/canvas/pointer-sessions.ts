"use client";

/**
 * Doc 07 §7.1–§7.6 — the pointer gesture entry machine (down).
 * The move/commit half lives in `pointer-sessions-end.ts`.
 */
import {
  hitTest,
  hitTestHandle,
  hitTolerance,
  selectionBBox,
  type MeasureFn,
} from "@/lib/canvas/geometry";
import {
  beginDrag,
  beginInk,
  isDragTool,
  type DragModifiers,
  type DragState,
  type InkState,
} from "@/lib/canvas/interaction";
import type { EditorTool } from "@/lib/canvas/tools";
import type { HandleId, Point, Rect, Stroke, StrokeStyle } from "@/lib/canvas/types";
import type { Scene } from "./scene";

export interface PointerContext {
  scene: Scene;
  tool: EditorTool;
  style: StrokeStyle;
  blurMode: "pixelate" | "blur";
  blurStrength: number;
  reviewMode: boolean;
  measure: MeasureFn;
  invalidate: (layer?: "base" | "ink" | "overlay" | "all") => void;
  commitStroke: (stroke: Stroke) => void;
  deleteStrokes: (ids: string[]) => void;
  replaceStrokes: (pairs: Array<{ prev: Stroke; next: Stroke }>) => void;
  requestText: (anchor: Point, box: Point) => void;
  announce: (message: string) => void;
  onSelect: (ids: string[]) => void;
}

export interface DragSession {
  kind: "drag";
  state: DragState;
  altAtStart: boolean;
  cssOrigin: Point;
}
export interface InkSession {
  kind: "ink";
  state: InkState;
}
export interface MoveSession {
  kind: "move";
  origin: Point;
  moves: Array<{ prev: Stroke; next: Stroke }>;
}
export interface ResizeSession {
  kind: "resize";
  origin: Point;
  handle: HandleId;
  bbox: Rect;
  members: Array<{ prev: Stroke; next: Stroke }>;
}
export interface MarqueeSession {
  kind: "marquee";
  origin: Point;
}

export type Session = DragSession | InkSession | MoveSession | ResizeSession | MarqueeSession;

export function modsOf(event: { shiftKey: boolean; altKey: boolean }): DragModifiers {
  return { shiftKey: event.shiftKey, altKey: event.altKey };
}

export interface PointerStart {
  clientX: number;
  clientY: number;
  cssLocal: Point;
  mods: DragModifiers;
}

/** Returns the session to run, or `null` when the gesture was a one-shot. */
export function beginPointerSession(
  ctx: PointerContext,
  point: Point,
  start: PointerStart,
): Session | null {
  const { scene } = ctx;
  if (scene.imageStatus !== "ready" || ctx.reviewMode) return null;
  scene.pointerDown = true;
  scene.hoveredId = null;

  const tolerance = hitTolerance(scene.view, ctx.style.width);
  const hitOptions = { tolerance, measure: ctx.measure, interior: start.mods.altKey };

  if (ctx.tool === "select") return beginSelect(ctx, point, start, hitOptions);
  if (ctx.tool === "eraser") {
    const hit = hitTest(point, scene.doc, { ...hitOptions, tolerance: tolerance * 1.5 });
    scene.pointerDown = false;
    if (hit) ctx.deleteStrokes([hit.id]);
    return null;
  }
  if (ctx.tool === "pen") return { kind: "ink", state: beginInk(point, ctx.style, start.mods) };
  if (ctx.tool === "text") {
    scene.pointerDown = false;
    ctx.requestText(point, { x: point.x + 28, y: Math.max(8, point.y - 72) });
    return null;
  }
  if (isDragTool(ctx.tool)) {
    return {
      kind: "drag",
      state: beginDrag(
        ctx.tool,
        point,
        ctx.style,
        { mode: ctx.blurMode, strength: ctx.blurStrength },
        start.mods,
      ),
      altAtStart: start.mods.altKey,
      cssOrigin: { x: start.clientX, y: start.clientY },
    };
  }
  scene.pointerDown = false;
  return null;
}

function beginSelect(
  ctx: PointerContext,
  point: Point,
  start: PointerStart,
  hitOptions: { tolerance: number; measure: MeasureFn; interior: boolean },
): Session | null {
  const { scene } = ctx;
  const selected = scene.doc.strokes.filter((s) => scene.selection.has(s.id));
  const bbox = selected.length > 0 ? selectionBBox(selected, ctx.measure) : null;
  const handle = bbox ? hitTestHandle(start.cssLocal, bbox, scene.view) : null;
  if (handle && bbox) {
    return {
      kind: "resize",
      origin: point,
      handle,
      bbox,
      members: selected.map((s) => ({ prev: s, next: s })),
    };
  }
  const hit = hitTest(point, scene.doc, hitOptions);
  if (!hit) {
    ctx.onSelect([]);
    return { kind: "marquee", origin: point };
  }
  let nextSelection = scene.selection;
  if (start.mods.shiftKey) {
    const next = new Set(scene.selection);
    if (next.has(hit.id)) next.delete(hit.id);
    else next.add(hit.id);
    nextSelection = next;
    ctx.onSelect([...next]);
  } else if (!scene.selection.has(hit.id)) {
    nextSelection = new Set([hit.id]);
    ctx.onSelect([hit.id]);
  }
  const moving = scene.doc.strokes.filter((s) => nextSelection.has(s.id));
  return { kind: "move", origin: point, moves: moving.map((s) => ({ prev: s, next: s })) };
}

export function cancelSession(ctx: PointerContext, restoreDoc: () => void): void {
  const { scene } = ctx;
  scene.marquee = null;
  scene.previewStroke = null;
  scene.previewBlur = null;
  scene.pointerDown = false;
  restoreDoc();
  ctx.invalidate("all");
}
