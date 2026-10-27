import { decimate, strokeHit } from "./geometry";
import type { MarkupDocument, MarkupPoint, MarkupStroke } from "./types";

/**
 * Immutable document commands. Every function returns a new document so the
 * history stack can hold plain references without cloning on every undo.
 */

const CAP = 200;
const POINT_CAP = 4_000;

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `stroke_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function beginStroke(
  color: string,
  width: number,
  start: MarkupPoint,
): MarkupStroke {
  return { id: makeId(), tool: "pen", color, width, points: [start] };
}

export function extendStroke(stroke: MarkupStroke, point: MarkupPoint): MarkupStroke {
  const last = stroke.points[stroke.points.length - 1];
  // Skip micro-moves: they add bytes without adding shape.
  if (Math.hypot(point.x - last.x, point.y - last.y) < 1.2) return stroke;
  return { ...stroke, points: [...stroke.points, point].slice(-POINT_CAP) };
}

export function commitStroke(doc: MarkupDocument, stroke: MarkupStroke): MarkupDocument {
  const points = decimate(stroke.points);
  if (points.length === 0) return doc;
  return { ...doc, strokes: [...doc.strokes, { ...stroke, points }].slice(-CAP) };
}

/** Erase every stroke the path touches; returns the same doc when nothing was hit. */
export function eraseAt(
  doc: MarkupDocument,
  point: MarkupPoint,
  radius: number,
): MarkupDocument {
  const survivors = doc.strokes.filter((stroke) => !strokeHit(stroke, point, radius));
  return survivors.length === doc.strokes.length ? doc : { ...doc, strokes: survivors };
}

export function eraseMany(
  doc: MarkupDocument,
  points: readonly MarkupPoint[],
  radius: number,
): MarkupDocument {
  if (points.length === 0) return doc;
  const survivors = doc.strokes.filter(
    (stroke) => !points.some((point) => strokeHit(stroke, point, radius)),
  );
  return survivors.length === doc.strokes.length ? doc : { ...doc, strokes: survivors };
}

export function clearAll(doc: MarkupDocument): MarkupDocument {
  return doc.strokes.length === 0 ? doc : { ...doc, strokes: [] };
}

export function isDirty(doc: MarkupDocument): boolean {
  return doc.strokes.length > 0;
}
