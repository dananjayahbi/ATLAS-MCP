/**
 * Doc 07 §6 / §7.5 / §7.6 — all coordinate maths and hit-testing.
 *
 * This is the ONLY module allowed to divide or multiply by `view.scale`
 * (§6.2 normative rule). Everything else consumes the helpers here.
 *
 * Spaces: screen px (event.clientX/Y) → css px (wrapper-relative) → image
 * natural px (persisted). See §6.1.
 */
import type {
  CanvasDocument,
  HandleId,
  Point,
  Rect,
  Stroke,
  TextStroke,
  ViewTransform,
} from "./types";

/* ------------------------------------------------------------------ space */

export interface ViewportRect {
  width: number;
  height: number;
}

/** css = image * scale + t */
export function toImageSpace(p: Point, v: ViewTransform): Point {
  return { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale };
}

export function toScreenSpace(p: Point, v: ViewTransform): Point {
  return { x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty };
}

export function eventToCss(
  e: { clientX: number; clientY: number },
  el: { getBoundingClientRect(): DOMRect },
): Point {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** The single edge of the system: pointer event → model coordinates. */
export function eventToImage(
  e: { clientX: number; clientY: number },
  el: { getBoundingClientRect(): DOMRect },
  v: ViewTransform,
): Point {
  return toImageSpace(eventToCss(e, el), v);
}

/** Hit tolerance in image px (§7.5): `max(6 / scale, width / 2)`. */
export function hitTolerance(v: ViewTransform, strokeWidth: number): number {
  return Math.max(6 / v.scale, strokeWidth / 2);
}

/* ------------------------------------------------------------------ rects */

/** All four drag quadrants → `w,h >= 0` (§4.2). */
export function normaliseRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function rectFromBounds(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function inflateRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x || y1 <= y) return null;
  return { x, y, w: x1 - x, h: y1 - y };
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

export function clampPoint(p: Point, size: { w: number; h: number }): Point {
  return {
    x: Math.min(Math.max(p.x, 0), size.w),
    y: Math.min(Math.max(p.y, 0), size.h),
  };
}

export function clampRectIn(r: Rect, size: { w: number; h: number }): Rect {
  const w = Math.min(r.w, size.w);
  const h = Math.min(r.h, size.h);
  return {
    x: Math.min(Math.max(r.x, 0), size.w - w),
    y: Math.min(Math.max(r.y, 0), size.h - h),
    w,
    h,
  };
}

/* ---------------------------------------------------------------- segments */

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Outline band + optional interior (§4.1). */
export function hitsRectOutline(r: Rect, p: Point, tol: number): boolean {
  const outer = inflateRect(r, tol);
  if (!rectContainsPoint(outer, p)) return false;
  const inner = inflateRect(r, -tol);
  return !(inner.w > 0 && inner.h > 0 && rectContainsPoint(inner, p));
}

/* ------------------------------------------------------------ callout text */

/** Font stack matches the renderer so measurement and drawing agree. */
export const CALLOUT_FONT_FAMILY = '"JetBrains Mono", "Geist Mono", ui-monospace, monospace';
export const CALLOUT_PADDING_EM = 0.5;
export const CALLOUT_LINE_HEIGHT = 1.3;
export const MAX_CALLOUT_LINES = 4;

export type MeasureFn = (text: string, font: string) => number;

export function calloutFont(fontSize: number): string {
  return `600 ${fontSize}px ${CALLOUT_FONT_FAMILY}`;
}

/** Greedy wrap honouring explicit newlines, capped at 4 rendered lines (§10.4). */
export function wrapCalloutText(
  text: string,
  fontSize: number,
  wrapWidth: number,
  measure: MeasureFn,
): string[] {
  const font = calloutFont(fontSize);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (lines.length >= MAX_CALLOUT_LINES) break;
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, font) <= wrapWidth || current === "") {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
        if (lines.length >= MAX_CALLOUT_LINES) break;
      }
    }
    if (current && lines.length < MAX_CALLOUT_LINES) lines.push(current);
  }
  const capped = lines.slice(0, MAX_CALLOUT_LINES);
  if (lines.length > MAX_CALLOUT_LINES && capped.length > 0) {
    capped[capped.length - 1] = `${capped[capped.length - 1].slice(0, -1)}…`;
  }
  return capped;
}

/** Chip geometry is DERIVED from text + fontSize + wrapWidth (§3.1, §4.6). */
export function calloutChipRect(stroke: TextStroke, measure: MeasureFn): Rect {
  const lines = wrapCalloutText(stroke.text, stroke.fontSize, stroke.wrapWidth, measure);
  const charWidth = measure("M", calloutFont(stroke.fontSize)) || stroke.fontSize * 0.6;
  const padX = stroke.fontSize * 0.6;
  const padY = stroke.fontSize * CALLOUT_PADDING_EM;
  const widest = lines.reduce((max, line) => Math.max(max, line.length * charWidth * 0.92), 0);
  const w = Math.max(widest, stroke.wrapWidth * 0.35) + padX * 2;
  const h = lines.length * stroke.fontSize * CALLOUT_LINE_HEIGHT + padY * 2;
  return { x: stroke.box.x, y: stroke.box.y, w, h };
}

/** Leader starts at the chip edge nearest the anchor (§4.6). */
export function calloutLeaderStart(chip: Rect, anchor: Point): Point {
  const cx = chip.x + chip.w / 2;
  const cy = chip.y + chip.h / 2;
  const dx = anchor.x - cx;
  const dy = anchor.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx === 0 ? Infinity : chip.w / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : chip.h / 2 / Math.abs(dy);
  const k = Math.min(scaleX, scaleY);
  return { x: cx + dx * k, y: cy + dy * k };
}

/* ------------------------------------------------------------------- bbox */

export function strokeBBox(stroke: Stroke, measure: MeasureFn): Rect {
  switch (stroke.tool) {
    case "rect":
    case "highlight":
    case "blur":
      return stroke.rect;
    case "arrow":
    case "line":
      return normaliseRect(stroke.from, stroke.to);
    case "freehand": {
      const bounds = rectFromBounds(
        stroke.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })),
      );
      return bounds ?? { x: 0, y: 0, w: 0, h: 0 };
    }
    case "text": {
      const chip = calloutChipRect(stroke, measure);
      return rectFromBounds([chip, { x: stroke.anchor.x, y: stroke.anchor.y, w: 0, h: 0 }]) ?? chip;
    }
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

export function selectionBBox(strokes: Stroke[], measure: MeasureFn): Rect | null {
  return rectFromBounds(strokes.map((s) => strokeBBox(s, measure)));
}

/* -------------------------------------------------------------- hit-tests */

export interface HitOptions {
  tolerance: number;
  /** §4.1 — interior hit only when Alt is held so nested boxes stay pickable. */
  interior?: boolean;
  measure: MeasureFn;
}

export function hitTestStroke(p: Point, stroke: Stroke, opts: HitOptions): boolean {
  const tol = opts.tolerance;
  switch (stroke.tool) {
    case "rect":
    case "blur":
      return hitsRectOutline(stroke.rect, p, tol) || (opts.interior === true && rectContainsPoint(stroke.rect, p));
    case "highlight":
      return rectContainsPoint(inflateRect(stroke.rect, tol), p);
    case "line":
    case "arrow":
      return distanceToSegment(p, stroke.from, stroke.to) <= Math.max(tol, stroke.style.width / 2);
    case "freehand": {
      const limit = Math.max(tol, stroke.style.width / 2);
      const pts = stroke.points;
      if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= limit;
      for (let i = 1; i < pts.length; i += 1) {
        if (distanceToSegment(p, pts[i - 1], pts[i]) <= limit) return true;
      }
      return false;
    }
    case "text": {
      const chip = calloutChipRect(stroke, opts.measure);
      if (rectContainsPoint(inflateRect(chip, tol), p)) return true;
      const start = calloutLeaderStart(chip, stroke.anchor);
      return distanceToSegment(p, start, stroke.anchor) <= tol;
    }
    default:
      return false;
  }
}

/** Reverse paint order — topmost wins (§7.5). */
export function hitTest(p: Point, doc: CanvasDocument, opts: HitOptions): Stroke | null {
  for (let i = doc.strokes.length - 1; i >= 0; i -= 1) {
    const stroke = doc.strokes[i];
    if (hitTestStroke(p, stroke, opts)) return stroke;
  }
  return null;
}

/* ----------------------------------------------------------------- handles */

/** Constant 8 CSS px regardless of zoom (§7.6). */
export const HANDLE_SCREEN_SIZE = 8;

const HANDLE_ORDER: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function handlePoints(bbox: Rect): Array<{ id: HandleId; point: Point }> {
  const { x, y, w, h } = bbox;
  const map: Record<HandleId, Point> = {
    nw: { x, y },
    n: { x: x + w / 2, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 },
  };
  return HANDLE_ORDER.map((id) => ({ id, point: map[id] }));
}

/** Screen-space pick for the 8 handles; screen coords keep them clickable. */
export function hitTestHandle(
  css: Point,
  bboxImage: Rect,
  v: ViewTransform,
): HandleId | null {
  const half = HANDLE_SCREEN_SIZE / 2 + 2;
  for (const { id, point } of handlePoints(bboxImage)) {
    const s = toScreenSpace(point, v);
    if (Math.abs(css.x - s.x) <= half && Math.abs(css.y - s.y) <= half) return id;
  }
  return null;
}

export const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

export interface ResizeModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * §7.6 — move the edges owned by `handle`. Minimum size is enforced by the
 * caller (4 image px) so a shrink past the floor can delete the stroke.
 */
export function resizeRectByHandle(
  initial: Rect,
  handle: HandleId,
  delta: Point,
  mods: ResizeModifiers = {},
): Rect {
  let x0 = initial.x;
  let y0 = initial.y;
  let x1 = initial.x + initial.w;
  let y1 = initial.y + initial.h;

  if (handle.includes("w")) x0 += delta.x;
  if (handle.includes("e")) x1 += delta.x;
  if (handle.includes("n")) y0 += delta.y;
  if (handle.includes("s")) y1 += delta.y;

  if (mods.altKey) {
    if (handle.includes("w")) x1 -= delta.x;
    if (handle.includes("e")) x0 -= delta.x;
    if (handle.includes("n")) y1 -= delta.y;
    if (handle.includes("s")) y0 -= delta.y;
  }

  if (mods.shiftKey && isCorner(handle)) {
    // §4.1 — Shift preserves the *original* aspect ratio on corners (unlike
    // §4.2's drag-to-create square). The anchor is the opposite corner unless
    // Alt is holding the centre.
    const aspect = initial.h > 0 ? initial.w / initial.h : 1;
    const absW = Math.abs(x1 - x0);
    const absH = Math.abs(y1 - y0);
    const driveWidth = initial.w > 0 ? absW / initial.w >= absH / Math.max(initial.h, 1e-6) : true;
    const w = Math.max(1, driveWidth ? absW : absH * aspect);
    const h = Math.max(1, driveWidth ? absW / aspect : absH);
    if (mods.altKey) {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      x0 = cx - w / 2;
      x1 = cx + w / 2;
      y0 = cy - h / 2;
      y1 = cy + h / 2;
    } else {
      const anchorX = handle.includes("w") ? initial.x + initial.w : initial.x;
      const anchorY = handle.includes("n") ? initial.y + initial.h : initial.y;
      if (handle.includes("w")) {
        x0 = anchorX - w;
        x1 = anchorX;
      } else {
        x0 = anchorX;
        x1 = anchorX + w;
      }
      if (handle.includes("n")) {
        y0 = anchorY - h;
        y1 = anchorY;
      } else {
        y0 = anchorY;
        y1 = anchorY + h;
      }
    }
  }

  return normaliseRect({ x: x0, y: y0 }, { x: x1, y: y1 });
}

export function isCorner(handle: HandleId): boolean {
  return handle === "nw" || handle === "ne" || handle === "se" || handle === "sw";
}

/** §4.2 — Shift makes a square anchored at the drag origin. */
export function squareRect(a: Point, b: Point, fromCentre: boolean): Rect {
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const sx = b.x < a.x ? -1 : 1;
  const sy = b.y < a.y ? -1 : 1;
  if (fromCentre) {
    return normaliseRect({ x: a.x - side, y: a.y - side }, { x: a.x + side, y: a.y + side });
  }
  return normaliseRect(a, { x: a.x + side * sx, y: a.y + side * sy });
}

/** §4.3 — snap to 15° increments so "straight up" is reproducible. */
export function snapAngle(from: Point, to: Point, stepDeg = 15): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...to };
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

/* --------------------------------------------------------------- freehand */

/** Ramer–Douglas–Peucker, ε in image px (§4.5). */
export function simplifyPoints(points: Point[], epsilon: number, cap = 2_000): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = distanceToSegment(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(points[i]);
  if (out.length <= cap) return out;
  // Evenly decimate rather than truncate so the shape survives the cap.
  const step = out.length / cap;
  const capped: Point[] = [];
  for (let i = 0; i < cap - 1; i += 1) capped.push(out[Math.floor(i * step)]);
  capped.push(out[out.length - 1]);
  return capped;
}

/** §4.5 — Shift constrains the whole stroke to the pen-down→cursor line. */
export function constrainToLine(start: Point, end: Point): Point[] {
  return [start, end];
}
