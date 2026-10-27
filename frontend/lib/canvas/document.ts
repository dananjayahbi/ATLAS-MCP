/**
 * Doc 07 §3 / §13 — versioned document serialisation.
 *
 * `serialiseDocument` is the only writer; `deserialiseDocument` validates and
 * clamps. Rejection is explicit (`null`) rather than throwing so restore
 * flows can degrade gracefully (§13.3).
 */
import { CanvasError } from "./errors";
import {
  CANVAS_DOC_VERSION,
  MAX_FONT_SIZE,
  MAX_RAW_POINTS,
  MAX_STROKES,
  MAX_STROKE_POINTS,
  MAX_STROKE_WIDTH,
  MAX_TEXT_CHARS,
  MIN_FONT_SIZE,
  MIN_STROKE_WIDTH,
  isLabellableTool,
  type CanvasDocument,
  type CanvasLegend,
  type Point,
  type Rect,
  type Size,
  type Stroke,
  type StrokeStyle,
  type StrokeTool,
} from "./types";

export const SUPPORTED_TOOL_NAMES: readonly StrokeTool[] = [
  "rect",
  "arrow",
  "line",
  "freehand",
  "highlight",
  "blur",
  "text",
];

/** Absolute clamp for persisted geometry: a 100 000 px document is nonsense. */
export const MAX_COORDINATE = 100_000;

export function createEmptyDocument(sourceAssetId: string, image: Size): CanvasDocument {
  return {
    version: CANVAS_DOC_VERSION,
    sourceAssetId,
    imageNaturalSize: { w: Math.max(1, Math.round(image.w)), h: Math.max(1, Math.round(image.h)) },
    strokes: [],
    crop: null,
    legend: { enabled: false, items: [] },
  };
}

/* --------------------------------------------------------------- writers */

export function serialiseDocument(doc: CanvasDocument): string {
  return JSON.stringify(sanitiseDocument(doc));
}

/**
 * Page-load entry point. Refuses forward-incompatible versions with a
 * `CANVAS_RESTORE_VERSION` error (§13.3), otherwise returns `null` so callers
 * never have to catch.
 */
export function deserialiseDocument(raw: string): CanvasDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return migrate(parsed);
}

export interface RestoreOutcome {
  doc: CanvasDocument | null;
  error: CanvasError | null;
}

/** Same as `deserialiseDocument` but distinguishes "newer version" for the UI. */
export function restoreDocument(raw: string): RestoreOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { doc: null, error: null };
  }
  if (isPlainObject(parsed) && typeof parsed.version === "number" && parsed.version > CANVAS_DOC_VERSION) {
    return { doc: null, error: new CanvasError("CANVAS_RESTORE_VERSION") };
  }
  return { doc: migrate(parsed), error: null };
}

/* -------------------------------------------------------------- migration */

/**
 * §3.3 — v0 payloads predate the `tool`/`style.width` names. Anything newer
 * than `CANVAS_DOC_VERSION` is forward-incompatible and refused.
 */
export function migrate(raw: unknown): CanvasDocument | null {
  if (!isPlainObject(raw)) return null;
  const version = typeof raw.version === "number" ? raw.version : 0;
  if (version > CANVAS_DOC_VERSION) return null;
  const upgraded = version === 0 ? upgradeV0(raw) : raw;
  const doc = coerceDocument(upgraded);
  return doc ? sanitiseDocument(doc) : null;
}

function upgradeV0(raw: Record<string, unknown>): Record<string, unknown> {
  const strokes = Array.isArray(raw.strokes) ? raw.strokes : [];
  const legacyToolMap: Record<string, StrokeTool> = {
    pen: "freehand",
    freehand: "freehand",
    rect: "rect",
    arrow: "arrow",
    text: "text",
    blur: "blur",
    line: "line",
    highlight: "highlight",
  };
  const upgraded = strokes.map((entry) => {
    if (!isPlainObject(entry)) return entry;
    const tool = typeof entry.tool === "string" ? entry.tool : "";
    const next: Record<string, unknown> = { ...entry };
    next.tool = legacyToolMap[tool] ?? tool;
    const thickness = entry.thickness;
    if (typeof thickness === "number" && entry.style === undefined) {
      next.style = {
        color: typeof entry.color === "string" ? entry.color : "#FF2D55",
        width: thickness,
        opacity: 1,
      };
    }
    delete next.thickness;
    return next;
  });
  return { ...raw, version: 1, strokes: upgraded };
}

/* -------------------------------------------------------------- sanitise */

/**
 * §3.3 / §11.2 — clamps every number into range, drops unknown tools, caps
 * point arrays and stroke count. Unknown *fields* are dropped by `coerce*`
 * rebuild (the model is the contract; forward tolerance lives in `migrate`).
 */
export function sanitiseDocument(doc: CanvasDocument): CanvasDocument {
  const image = sanitiseSize(doc.imageNaturalSize);
  const strokes = dedupeIds(
    doc.strokes
      .map((s) => sanitiseStroke(s, image))
      .filter((s): s is Stroke => s !== null)
      .slice(0, MAX_STROKES),
  );
  const crop = sanitiseCrop(doc.crop, image);
  return {
    version: CANVAS_DOC_VERSION,
    sourceAssetId: typeof doc.sourceAssetId === "string" ? doc.sourceAssetId : "",
    imageNaturalSize: image,
    strokes,
    crop,
    legend: sanitiseLegend(doc.legend, strokes),
  };
}

function sanitiseSize(size: Size | undefined): Size {
  const w = clampNumber(size?.w, 1, MAX_COORDINATE, 1);
  const h = clampNumber(size?.h, 1, MAX_COORDINATE, 1);
  return { w: Math.round(w), h: Math.round(h) };
}

function sanitiseStroke(stroke: Stroke, image: Size): Stroke | null {
  if (!isPlainObject(stroke)) return null;
  const tool = typeof stroke.tool === "string" ? stroke.tool : "";
  if (!SUPPORTED_TOOL_NAMES.includes(tool as StrokeTool)) return null;
  const base = sanitiseBase(stroke, tool as StrokeTool);
  switch (tool) {
    case "rect": {
      const rect = sanitiseRect(stroke.rect, image);
      if (!rect) return null;
      return { ...base, tool: "rect", rect, radius: Math.max(0, clampNumber(stroke.radius, 0, 64, 0)) };
    }
    case "highlight": {
      const rect = sanitiseRect(stroke.rect, image);
      if (!rect) return null;
      return { ...base, tool: "highlight", rect };
    }
    case "blur": {
      const rect = sanitiseRect(stroke.rect, image);
      if (!rect) return null;
      return {
        ...base,
        tool: "blur",
        rect,
        mode: stroke.mode === "blur" ? "blur" : "pixelate",
        strength: clampNumber(stroke.strength, 1, 256, 8),
      };
    }
    case "line":
    case "arrow": {
      const from = sanitisePoint(stroke.from, image);
      const to = sanitisePoint(stroke.to, image);
      if (!from || !to) return null;
      return { ...base, tool, from, to };
    }
    case "freehand": {
      const raw = Array.isArray(stroke.points) ? stroke.points : [];
      const points = raw
        .slice(-MAX_RAW_POINTS)
        .map((p) => sanitisePoint(p, image))
        .filter((p): p is Point => p !== null)
        .slice(0, MAX_STROKE_POINTS);
      if (points.length === 0) return null;
      return { ...base, tool: "freehand", points };
    }
    case "text": {
      const anchor = sanitisePoint(stroke.anchor, image);
      const box = sanitisePoint(stroke.box, image);
      if (!anchor || !box) return null;
      const text = typeof stroke.text === "string" ? stroke.text.slice(0, MAX_TEXT_CHARS) : "";
      return {
        ...base,
        tool: "text",
        anchor,
        box,
        text,
        fontSize: clampNumber(stroke.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, 14),
        wrapWidth: clampNumber(stroke.wrapWidth, 40, MAX_COORDINATE, 320),
      };
    }
    default:
      return null;
  }
}

function sanitiseBase(stroke: Record<string, unknown>, tool: StrokeTool) {
  const style = sanitiseStyle(stroke.style);
  const label = isLabellableTool(tool) ? sanitiseLabel(stroke.label) : undefined;
  const createdAt = clampNumber(stroke.createdAt, 0, Number.MAX_SAFE_INTEGER, 0);
  const base = {
    id: typeof stroke.id === "string" && stroke.id.length > 0 ? stroke.id : makeId(),
    style,
    createdAt,
  };
  return label === undefined ? base : { ...base, label };
}

function sanitiseStyle(style: unknown): StrokeStyle {
  const record = isPlainObject(style) ? style : {};
  const color = typeof record.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(record.color)
    ? (record.color as StrokeStyle["color"])
    : "#FF2D55";
  const dashRaw = Array.isArray(record.dash) ? record.dash : null;
  const dash = dashRaw
    ? dashRaw.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0)
    : null;
  return {
    color,
    width: clampNumber(record.width, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH, MIN_STROKE_WIDTH),
    opacity: clampNumber(record.opacity, 0.05, 1, 1),
    dash: dash && dash.length > 0 ? dash : null,
  };
}

function sanitiseLabel(label: unknown): number | undefined {
  if (typeof label !== "number" || !Number.isFinite(label) || label < 1) return undefined;
  return Math.min(Math.floor(label), 9_999);
}

function sanitisePoint(point: unknown, image: Size): Point | null {
  if (!isPlainObject(point)) return null;
  const x = point.x;
  const y = point.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: clampNumber(x, -MAX_COORDINATE, image.w + MAX_COORDINATE, 0),
    y: clampNumber(y, -MAX_COORDINATE, image.h + MAX_COORDINATE, 0),
  };
}

function sanitiseRect(rect: unknown, image: Size): Rect | null {
  if (!isPlainObject(rect)) return null;
  const { x, y, w, h } = rect;
  if ([x, y, w, h].some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  const width = clampNumber(w, 0, image.w, 0);
  const height = clampNumber(h, 0, image.h, 0);
  if (width <= 0 || height <= 0) return null;
  return {
    x: clampNumber(x, -MAX_COORDINATE, MAX_COORDINATE, 0),
    y: clampNumber(y, -MAX_COORDINATE, MAX_COORDINATE, 0),
    w: width,
    h: height,
  };
}

function sanitiseCrop(crop: CanvasDocument["crop"], image: Size): CanvasDocument["crop"] {
  if (!isPlainObject(crop) || !isPlainObject(crop.rect)) return null;
  const rect = sanitiseRect(crop.rect, image);
  if (!rect) return null;
  // §4.9 — a crop below 64 px on either axis is rejected.
  if (rect.w < 64 || rect.h < 64) return null;
  return { rect };
}

function sanitiseLegend(legend: CanvasLegend | undefined, strokes: Stroke[]): CanvasLegend {
  const enabled = isPlainObject(legend) ? legend.enabled === true : false;
  const rawItems = isPlainObject(legend) && Array.isArray(legend.items) ? legend.items : [];
  const known = new Set(
    strokes.map((s) => s.label).filter((l): l is number => typeof l === "number"),
  );
  const items = rawItems
    .filter((item): item is { label: number; text: string } => isPlainObject(item) && typeof item.label === "number")
    .map((item) => ({
      label: item.label,
      text: typeof item.text === "string" ? item.text.slice(0, MAX_TEXT_CHARS) : "",
    }))
    .filter((item) => known.has(item.label))
    .sort((a, b) => a.label - b.label);
  return { enabled, items };
}

function dedupeIds(strokes: Stroke[]): Stroke[] {
  const seen = new Set<string>();
  return strokes.map((stroke) => {
    if (!seen.has(stroke.id)) {
      seen.add(stroke.id);
      return stroke;
    }
    const id = makeId();
    seen.add(id);
    return { ...stroke, id };
  });
}

/* --------------------------------------------------------------- coercion */

function coerceDocument(raw: Record<string, unknown>): CanvasDocument | null {
  if (typeof raw.sourceAssetId !== "string") return null;
  if (!isPlainObject(raw.imageNaturalSize)) return null;
  const strokes = Array.isArray(raw.strokes) ? (raw.strokes as Stroke[]) : [];
  return {
    version: typeof raw.version === "number" ? raw.version : CANVAS_DOC_VERSION,
    sourceAssetId: raw.sourceAssetId,
    imageNaturalSize: {
      w: Number((raw.imageNaturalSize as Record<string, unknown>).w),
      h: Number((raw.imageNaturalSize as Record<string, unknown>).h),
    },
    strokes,
    crop: isPlainObject(raw.crop) ? coerceCrop(raw.crop) : null,
    legend: isPlainObject(raw.legend) ? coerceLegend(raw.legend) : { enabled: false, items: [] },
  };
}

function coerceCrop(value: unknown): CanvasDocument["crop"] {
  if (!isPlainObject(value)) return null;
  return value as unknown as NonNullable<CanvasDocument["crop"]>;
}

function coerceLegend(value: unknown): CanvasLegend {
  if (!isPlainObject(value)) return { enabled: false, items: [] };
  return value as unknown as CanvasLegend;
}

/* ----------------------------------------------------------------- helpers */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

let idCounter = 0;

export function makeId(): string {
  idCounter += 1;
  const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** §10.6 — identity, not rank: `max(existing) + 1` so deletions leave gaps. */
export function nextLabel(doc: CanvasDocument): number {
  return doc.strokes.reduce((max, s) => (typeof s.label === "number" ? Math.max(max, s.label) : max), 0) + 1;
}

export function countStrokes(doc: CanvasDocument): number {
  return doc.strokes.length;
}
