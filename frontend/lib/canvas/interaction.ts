/**
 * Doc 07 §7.4 — the shared drag-to-create state machine, framework-free.
 *
 * `beginDrag → updateDrag → commitDrag` covers rect/arrow/line/highlight/blur;
 * freehand is `beginInk → extendInk → commitInk`. Aborting is `cancelDrag`.
 * Nothing here touches React or the DOM.
 */
import {
  normaliseRect,
  simplifyPoints,
  snapAngle,
  squareRect,
  strokeBBox,
  type MeasureFn,
} from "./geometry";
import { defaultFontSize, defaultWrapWidth } from "./defaults";
import { makeId, nextLabel } from "./document";
import type { EditorTool } from "./tools";
import { strokeToolFor } from "./tools";
import {
  MIN_STROKE_WIDTH,
  type CanvasDocument,
  type Point,
  type Rect,
  type Stroke,
  type StrokeStyle,
} from "./types";
import { isLabellableTool } from "./types";

export interface DragModifiers {
  shiftKey: boolean;
  altKey: boolean;
}

export interface DragState {
  tool: EditorTool;
  origin: Point;
  current: Point;
  style: StrokeStyle;
  mods: DragModifiers;
  /** `true` once the pointer has travelled ≥ 3 CSS px (§7.4). */
  armed: boolean;
  blurMode: "pixelate" | "blur";
  blurStrength: number;
}

/** §4.2 — a click under 3 CSS px commits nothing. */
export const CLICK_THRESHOLD_PX = 3;

export function beginDrag(
  tool: EditorTool,
  origin: Point,
  style: StrokeStyle,
  blur: { mode: "pixelate" | "blur"; strength: number },
  mods: DragModifiers,
): DragState {
  return {
    tool,
    origin,
    current: origin,
    style,
    mods,
    armed: false,
    blurMode: blur.mode,
    blurStrength: blur.strength,
  };
}

/** `cssDistance` is the travel in CSS px (≈ image px ÷ scale). */
export function updateDrag(state: DragState, point: Point, cssDistance: number, mods: DragModifiers): DragState {
  return {
    ...state,
    current: point,
    mods,
    armed: state.armed || cssDistance >= CLICK_THRESHOLD_PX,
  };
}

export interface PreviewShape {
  rect: Rect | null;
  from: Point | null;
  to: Point | null;
}

export function dragPreview(state: DragState): PreviewShape {
  const { origin, current, mods, tool } = state;
  if (tool === "arrow" || tool === "line") {
    const to = mods.shiftKey ? snapAngle(origin, current) : current;
    return { rect: null, from: origin, to };
  }
  if (tool === "rect" || tool === "highlight" || tool === "blur") {
    const rect = mods.shiftKey
      ? squareRect(origin, current, mods.altKey)
      : mods.altKey
        ? normaliseRect(
            { x: origin.x - Math.abs(current.x - origin.x), y: origin.y - Math.abs(current.y - origin.y) },
            { x: origin.x + Math.abs(current.x - origin.x), y: origin.y + Math.abs(current.y - origin.y) },
          )
        : normaliseRect(origin, current);
    return { rect, from: null, to: null };
  }
  return { rect: null, from: null, to: null };
}

export interface CommitContext {
  doc: CanvasDocument;
  modifiersAtCommit: DragModifiers;
  /** Alt at pointer-down suppresses the auto label (§4.2). */
  altAtStart: boolean;
}

/** Returns the stroke to add, or `null` when the gesture is a click/too small. */
export function commitDrag(state: DragState, ctx: CommitContext): Stroke | null {
  if (!state.armed) return null;
  const tool = strokeToolFor(state.tool);
  if (!tool) return null;
  const preview = dragPreview(state);
  const label = labelFor(state.tool, ctx);

  if ((tool === "arrow" || tool === "line") && preview.from && preview.to) {
    const len = Math.hypot(preview.to.x - preview.from.x, preview.to.y - preview.from.y);
    if (len < 4) return null;
    return {
      id: makeId(),
      tool,
      style: stripDash(state.style),
      createdAt: Date.now(),
      ...(label === undefined ? {} : { label }),
      from: preview.from,
      to: preview.to,
    };
  }

  if (preview.rect) {
    const rect = preview.rect;
    if (rect.w < 2 || rect.h < 2) return null;
    if (tool === "blur") {
      return {
        id: makeId(),
        tool: "blur",
        style: state.style,
        createdAt: Date.now(),
        rect,
        mode: state.blurMode,
        strength: Math.max(2, state.blurStrength),
      };
    }
    if (tool === "highlight") {
      return {
        id: makeId(),
        tool: "highlight",
        style: { ...state.style, opacity: Math.min(Math.max(state.style.opacity, 0.12), 0.35) },
        createdAt: Date.now(),
        rect,
      };
    }
    return {
      id: makeId(),
      tool: "rect",
      style: stripDash(state.style),
      createdAt: Date.now(),
      ...(label === undefined ? {} : { label }),
      rect,
      radius: 0,
    };
  }
  return null;
}

function labelFor(tool: EditorTool, ctx: CommitContext): number | undefined {
  if (ctx.altAtStart) return undefined;
  const strokeTool = strokeToolFor(tool);
  if (!strokeTool || !isLabellableTool(strokeTool)) return undefined;
  return nextLabel(ctx.doc);
}

function stripDash(style: StrokeStyle): StrokeStyle {
  return { ...style, dash: null, width: Math.max(MIN_STROKE_WIDTH, style.width) };
}

/* ---------------------------------------------------------------- freehand */

export interface InkState {
  points: Point[];
  style: StrokeStyle;
  mods: DragModifiers;
  origin: Point;
}

export function beginInk(origin: Point, style: StrokeStyle, mods: DragModifiers): InkState {
  return { points: [origin], style, mods, origin };
}

export function extendInk(state: InkState, point: Point, mods: DragModifiers): InkState {
  return { ...state, points: [...state.points, point], mods };
}

/** §4.5 — one history entry per pen-down→pen-up regardless of point count. */
export function commitInk(state: InkState, viewScale: number): Stroke | null {
  let points = state.points;
  if (state.mods.shiftKey) {
    points = [state.origin, points[points.length - 1]];
  }
  if (points.length === 0) return null;
  const simplified = points.length > 2 ? simplifyPoints(points, 0.6 / Math.max(viewScale, 0.001)) : points;
  return {
    id: makeId(),
    tool: "freehand",
    style: stripDash(state.style),
    createdAt: Date.now(),
    points: simplified,
  };
}

/* ------------------------------------------------------------------- text */

export interface TextPlacement {
  anchor: Point;
  box: Point;
  fontSize: number;
  wrapWidth: number;
}

export function placeCallout(
  doc: CanvasDocument,
  anchor: Point,
  box: Point,
): TextPlacement {
  return {
    anchor,
    box,
    fontSize: defaultFontSize(doc.imageNaturalSize.w),
    wrapWidth: defaultWrapWidth(doc.imageNaturalSize),
  };
}

export function buildTextStroke(
  placement: TextPlacement,
  text: string,
  style: StrokeStyle,
  label: number | undefined,
): Stroke | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return {
    id: makeId(),
    tool: "text",
    style: stripDash(style),
    createdAt: Date.now(),
    ...(label === undefined ? {} : { label }),
    anchor: placement.anchor,
    box: placement.box,
    text: trimmed,
    fontSize: placement.fontSize,
    wrapWidth: placement.wrapWidth,
  };
}

/* ---------------------------------------------------------------- erasing */

/** §4.0 eraser — resolve hits, then delete. Tolerance widens with the tool. */
export function eraserTolerance(viewScale: number, width: number): number {
  return Math.max(10 / Math.max(viewScale, 0.001), width);
}

export function isDragTool(tool: EditorTool): boolean {
  return tool === "rect" || tool === "arrow" || tool === "line" || tool === "highlight" || tool === "blur";
}

/* -------------------------------------------------------------- previews */

/**
 * The overlay preview never enters the model, so it is rebuilt from the drag
 * state on every move rather than mutated (§11.3).
 */
export function previewStrokeFor(state: DragState, preview: PreviewShape): Stroke | null {
  if (preview.rect && state.tool !== "blur") {
    return {
      id: "preview-rect",
      tool: state.tool === "highlight" ? "highlight" : "rect",
      style: state.style,
      createdAt: 0,
      rect: preview.rect,
    };
  }
  if (preview.from && preview.to) {
    return {
      id: "preview-line",
      tool: state.tool === "arrow" ? "arrow" : "line",
      style: state.style,
      createdAt: 0,
      from: preview.from,
      to: preview.to,
    };
  }
  return null;
}

/* ------------------------------------------------------------ multi-select */

/** §7.8 — uniform scaling of the union bbox, applied member by member. */
export function scaleStrokeInBBox(stroke: Stroke, from: Rect, to: Rect): Stroke {
  const scaleX = from.w === 0 ? 1 : to.w / from.w;
  const scaleY = from.h === 0 ? 1 : to.h / from.h;
  const mapX = (x: number) => to.x + (x - from.x) * scaleX;
  const mapY = (y: number) => to.y + (y - from.y) * scaleY;
  switch (stroke.tool) {
    case "rect":
    case "highlight":
    case "blur":
      return {
        ...stroke,
        rect: {
          x: mapX(stroke.rect.x),
          y: mapY(stroke.rect.y),
          w: Math.max(2, stroke.rect.w * scaleX),
          h: Math.max(2, stroke.rect.h * scaleY),
        },
      };
    case "arrow":
    case "line":
      return {
        ...stroke,
        from: { x: mapX(stroke.from.x), y: mapY(stroke.from.y) },
        to: { x: mapX(stroke.to.x), y: mapY(stroke.to.y) },
      };
    case "freehand":
      return { ...stroke, points: stroke.points.map((p) => ({ x: mapX(p.x), y: mapY(p.y) })) };
    case "text":
      // §7.6 — a text resize adjusts `wrapWidth` only; the leader keeps its tip.
      return {
        ...stroke,
        anchor: { x: mapX(stroke.anchor.x), y: mapY(stroke.anchor.y) },
        box: { x: mapX(stroke.box.x), y: mapY(stroke.box.y) },
        wrapWidth: Math.max(80, stroke.wrapWidth * scaleX),
      };
    default:
      return stroke;
  }
}

/** Marquee → the set of stroke ids whose bbox intersects the band. */
export function marqueeSelection(doc: CanvasDocument, band: Rect, measure: MeasureFn): string[] {
  return doc.strokes
    .filter((stroke) => {
      const bbox = strokeBBox(stroke, measure);
      return (
        band.x < bbox.x + bbox.w &&
        band.x + band.w > bbox.x &&
        band.y < bbox.y + bbox.h &&
        band.y + band.h > bbox.y
      );
    })
    .map((stroke) => stroke.id);
}

export type { MeasureFn };
