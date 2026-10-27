"use client";

/**
 * Doc 07 §7.1–§7.6 — one `InteractionController` for every pointer gesture.
 *
 * Mutations are committed through the reducer; previews live in the scene ref
 * so a 240 Hz pointer stream never re-renders React (§2.2).
 */
import { useCallback, useRef } from "react";
import {
  hitTest,
  hitTestHandle,
  hitTolerance,
  resizeRectByHandle,
  selectionBBox,
  toImageSpace,
  type HitOptions,
} from "@/lib/canvas/geometry";
import {
  beginDrag,
  beginInk,
  commitDrag,
  commitInk,
  dragPreview,
  extendInk,
  isDragTool,
  marqueeSelection,
  previewStrokeFor,
  scaleStrokeInBBox,
  updateDrag,
  type DragModifiers,
  type DragState,
  type InkState,
} from "@/lib/canvas/interaction";
import type { EditorTool } from "@/lib/canvas/tools";
import type { HandleId, Point, Rect, Stroke, StrokeStyle } from "@/lib/canvas/types";
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
  /** Re-projects the committed document after an aborted gesture. */
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

interface DragSession {
  kind: "drag";
  state: DragState;
  altAtStart: boolean;
  cssOrigin: Point;
}

interface InkSession {
  kind: "ink";
  state: InkState;
}

interface MoveSession {
  kind: "move";
  origin: Point;
  moves: Array<{ prev: Stroke; next: Stroke }>;
}

interface ResizeSession {
  kind: "resize";
  origin: Point;
  handle: HandleId;
  bbox: Rect;
  members: Array<{ prev: Stroke; next: Stroke }>;
}

interface MarqueeSession {
  kind: "marquee";
  origin: Point;
}

type Session = DragSession | InkSession | MoveSession | ResizeSession | MarqueeSession;

function modsOf(event: { shiftKey: boolean; altKey: boolean }): DragModifiers {
  return { shiftKey: event.shiftKey, altKey: event.altKey };
}

function normalisePreview(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function useInteraction(deps: InteractionDeps): InteractionApi {
  const sessionRef = useRef<Session | null>(null);

  const localImage = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): Point => {
      const scene = deps.sceneRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      return toImageSpace({ x: event.clientX - rect.left, y: event.clientY - rect.top }, scene.view);
    },
    [deps.sceneRef],
  );

  const cancel = useCallback(() => {
    const scene = deps.sceneRef.current;
    sessionRef.current = null;
    scene.marquee = null;
    scene.previewStroke = null;
    scene.previewBlur = null;
    scene.pointerDown = false;
    // A cancelled gesture must not leave the preview projection in the scene,
    // nor a half-applied move/resize (there is no commit on cancel, §7.2).
    deps.restoreDoc();
    deps.invalidate("all");
  }, [deps]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const scene = deps.sceneRef.current;
      const point = localImage(event);
      if (scene.imageStatus !== "ready" || deps.reviewMode) return;
      const mods = modsOf(event);
      scene.pointerDown = true;
      scene.hoveredId = null;
      event.currentTarget.setPointerCapture(event.pointerId);

      const tolerance = hitTolerance(scene.view, deps.style.width);
      const hitOptions: HitOptions = { tolerance, measure: deps.measure, interior: mods.altKey };

      if (deps.tool === "select") {
        const rect = event.currentTarget.getBoundingClientRect();
        const cssPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const selected = scene.doc.strokes.filter((s) => scene.selection.has(s.id));
        const bbox = selected.length > 0 ? selectionBBox(selected, deps.measure) : null;
        const handle = bbox ? hitTestHandle(cssPoint, bbox, scene.view) : null;
        if (handle && bbox) {
          sessionRef.current = {
            kind: "resize",
            origin: point,
            handle,
            bbox,
            members: selected.map((s) => ({ prev: s, next: s })),
          };
          return;
        }
        const hit = hitTest(point, scene.doc, hitOptions);
        if (hit) {
          let nextSelection = scene.selection;
          if (mods.shiftKey) {
            const next = new Set(scene.selection);
            if (next.has(hit.id)) next.delete(hit.id);
            else next.add(hit.id);
            nextSelection = next;
            deps.onSelect([...next]);
          } else if (!scene.selection.has(hit.id)) {
            nextSelection = new Set([hit.id]);
            deps.onSelect([hit.id]);
          }
          const moving = scene.doc.strokes.filter((s) => nextSelection.has(s.id));
          sessionRef.current = {
            kind: "move",
            origin: point,
            moves: moving.map((s) => ({ prev: s, next: s })),
          };
          deps.invalidate("overlay");
          return;
        }
        deps.onSelect([]);
        sessionRef.current = { kind: "marquee", origin: point };
        deps.invalidate("overlay");
        return;
      }

      if (deps.tool === "eraser") {
        const hit = hitTest(point, scene.doc, { ...hitOptions, tolerance: tolerance * 1.5 });
        scene.pointerDown = false;
        if (hit) deps.deleteStrokes([hit.id]);
        return;
      }

      if (deps.tool === "pen") {
        sessionRef.current = { kind: "ink", state: beginInk(point, deps.style, mods) };
        deps.invalidate("overlay");
        return;
      }

      if (deps.tool === "text") {
        scene.pointerDown = false;
        deps.requestText(point, { x: point.x + 28, y: Math.max(8, point.y - 72) });
        return;
      }

      if (isDragTool(deps.tool)) {
        sessionRef.current = {
          kind: "drag",
          state: beginDrag(
            deps.tool,
            point,
            deps.style,
            { mode: deps.blurMode, strength: deps.blurStrength },
            mods,
          ),
          altAtStart: mods.altKey,
          cssOrigin: { x: event.clientX, y: event.clientY },
        };
      }
    },
    [deps, localImage],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const scene = deps.sceneRef.current;
      const session = sessionRef.current;
      const point = localImage(event);
      const rect = event.currentTarget.getBoundingClientRect();
      scene.cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };

      if (!session) {
        if (deps.tool === "select" && scene.imageStatus === "ready" && !deps.reviewMode) {
          const hit = hitTest(point, scene.doc, {
            tolerance: hitTolerance(scene.view, deps.style.width),
            measure: deps.measure,
            interior: event.altKey,
          });
          scene.hoveredId = hit?.id ?? null;
        }
        deps.invalidate("overlay");
        return;
      }

      const mods = modsOf(event);
      switch (session.kind) {
        case "drag": {
          const cssDistance = Math.hypot(
            event.clientX - session.cssOrigin.x,
            event.clientY - session.cssOrigin.y,
          );
          session.state = updateDrag(session.state, point, cssDistance, mods);
          const preview = dragPreview(session.state);
          const nextBlur = preview.rect && session.state.tool === "blur" ? preview.rect : null;
          scene.previewBlur = nextBlur;
          scene.previewStroke = previewStrokeFor(session.state, preview);
          deps.invalidate("overlay");
          if (nextBlur) deps.invalidate("base");
          return;
        }
        case "ink": {
          session.state = extendInk(session.state, point, mods);
          scene.previewStroke = {
            id: "preview-ink",
            tool: "freehand",
            style: session.state.style,
            createdAt: 0,
            points: session.state.points,
          };
          deps.invalidate("overlay");
          return;
        }
        case "move": {
          const dx = point.x - session.origin.x;
          const dy = point.y - session.origin.y;
          const nextMoves = session.moves.map((m) => ({ prev: m.prev, next: translateBy(m.prev, dx, dy) }));
          applyPreviewDoc(scene, nextMoves);
          session.moves = nextMoves;
          deps.invalidate("ink");
          deps.invalidate("overlay");
          return;
        }
        case "resize": {
          const delta = { x: point.x - session.origin.x, y: point.y - session.origin.y };
          const next = resizeRectByHandle(session.bbox, session.handle, delta, mods);
          const nextMoves = session.members.map((m) => ({
            prev: m.prev,
            next: scaleStrokeInBBox(m.prev, session.bbox, next),
          }));
          applyPreviewDoc(scene, nextMoves);
          session.members = nextMoves;
          deps.invalidate("ink");
          deps.invalidate("overlay");
          return;
        }
        case "marquee": {
          scene.marquee = normalisePreview(session.origin, point);
          deps.invalidate("overlay");
          return;
        }
        default:
          return;
      }
    },
    [deps, localImage],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const scene = deps.sceneRef.current;
      const session = sessionRef.current;
      sessionRef.current = null;
      scene.pointerDown = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!session) {
        deps.invalidate("overlay");
        return;
      }
      const point = localImage(event);
      switch (session.kind) {
        case "drag": {
          const stroke = commitDrag(session.state, {
            doc: scene.doc,
            modifiersAtCommit: modsOf(event),
            altAtStart: session.altAtStart,
          });
          scene.previewStroke = null;
          scene.previewBlur = null;
          if (stroke) deps.commitStroke(stroke);
          break;
        }
        case "ink": {
          const stroke = commitInk(session.state, scene.view.scale);
          scene.previewStroke = null;
          if (stroke) deps.commitStroke(stroke);
          break;
        }
        case "move": {
          const changes = session.moves;
          const changed = changes.filter((m) => m.prev !== m.next);
          if (changed.length > 0) deps.replaceStrokes(changed);
          else deps.invalidate("all");
          break;
        }
        case "resize": {
          const changes = session.members;
          const changed = changes.filter((m) => m.prev !== m.next);
          if (changed.length > 0) deps.replaceStrokes(changed);
          else deps.invalidate("all");
          break;
        }
        case "marquee": {
          const band = normalisePreview(session.origin, point);
          scene.marquee = null;
          const ids = marqueeSelection(scene.doc, band, deps.measure);
          deps.onSelect(ids);
          if (ids.length > 0) deps.announce(`${ids.length} annotation(s) selected.`);
          break;
        }
        default:
          break;
      }
      deps.invalidate("all");
    },
    [deps, localImage],
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

function translateBy(stroke: Stroke, dx: number, dy: number): Stroke {
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

function applyPreviewDoc(scene: Scene, moves: Array<{ prev: Stroke; next: Stroke }>): void {
  const byId = new Map(moves.map((m) => [m.prev.id, m.next]));
  scene.doc = {
    ...scene.doc,
    strokes: scene.doc.strokes.map((stroke) => byId.get(stroke.id) ?? stroke),
  };
}
