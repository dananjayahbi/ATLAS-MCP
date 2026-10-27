import type { MarkupPoint, MarkupStroke, MarkupView } from "./types";

/**
 * Geometry for the markup overlay. Image space is authoritative; CSS space is
 * derived per render from the live container size, never stored.
 */

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

/** CSS px = image px * scale + translate. */
export function toCss(point: MarkupPoint, view: MarkupView): MarkupPoint {
  return { x: point.x * view.scale + view.tx, y: point.y * view.scale + view.ty };
}

export function toImage(css: MarkupPoint, view: MarkupView): MarkupPoint {
  return { x: (css.x - view.tx) / view.scale, y: (css.y - view.ty) / view.scale };
}

/** Fit the image inside the container with a small, even margin. */
export function fitView(
  container: { w: number; h: number },
  image: { w: number; h: number },
  margin = 24,
): MarkupView {
  if (container.w <= 0 || container.h <= 0 || image.w <= 0 || image.h <= 0) {
    return { scale: 1, tx: 0, ty: 0 };
  }
  const available = {
    w: Math.max(1, container.w - margin * 2),
    h: Math.max(1, container.h - margin * 2),
  };
  const scale = Math.min(available.w / image.w, available.h / image.h, MAX_SCALE);
  return {
    scale,
    tx: (container.w - image.w * scale) / 2,
    ty: (container.h - image.h * scale) / 2,
  };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Zoom about a CSS anchor so the pixel under the cursor does not move. */
export function zoomAt(view: MarkupView, anchor: MarkupPoint, nextScale: number): MarkupView {
  const scale = clampScale(nextScale);
  const before = toImage(anchor, view);
  return { scale, tx: anchor.x - before.x * scale, ty: anchor.y - before.y * scale };
}

export function distance(a: MarkupPoint, b: MarkupPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from `p` to segment `a→b`, used by the eraser hit test. */
export function distanceToSegment(p: MarkupPoint, a: MarkupPoint, b: MarkupPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(p, a);
  const raw = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  const t = Math.max(0, Math.min(1, raw));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** A stroke is hit when any of its segments passes within `tolerance` image px. */
export function strokeHit(stroke: MarkupStroke, point: MarkupPoint, tolerance: number): boolean {
  const reach = tolerance + stroke.width / 2;
  if (stroke.points.length === 1) return distance(stroke.points[0], point) <= reach;
  for (let i = 1; i < stroke.points.length; i += 1) {
    if (distanceToSegment(point, stroke.points[i - 1], stroke.points[i]) <= reach) return true;
  }
  return false;
}

/** Drop points closer than `minDistance` so a stroke stays compact. */
export function decimate(points: MarkupPoint[], minDistance = 1.5): MarkupPoint[] {
  if (points.length <= 2) return points;
  const kept: MarkupPoint[] = [points[0]];
  for (const point of points.slice(1)) {
    if (distance(point, kept[kept.length - 1]) >= minDistance) kept.push(point);
  }
  const last = points[points.length - 1];
  if (distance(kept[kept.length - 1], last) > 0) kept.push(last);
  return kept;
}
