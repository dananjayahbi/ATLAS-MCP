/**
 * Doc 07 §3.1 / §3.2 — the canvas document model.
 *
 * Every value here is JSON-serialisable: no class instances, no DOM handles,
 * no `Date` objects, no `ImageBitmap`. All geometry is stored in
 * image-natural pixels (§6.3) so a 25 % preview and a 4K export agree.
 */
import type { AssetDTO } from "@/lib/types/enums";

/** §3.3 — `0` is reserved for pre-versioned payloads found in localStorage. */
export const CANVAS_DOC_VERSION = 1;

/** §11.2 budgets. Enforced by `sanitiseDocument`, not by the renderer. */
export const MAX_STROKES = 500;
export const MAX_STROKE_POINTS = 2_000;
export const MAX_RAW_POINTS = 20_000;
export const MAX_TEXT_CHARS = 280;
export const MAX_TEXT_LINES = 4;
export const MIN_STROKE_WIDTH = 3;
export const MAX_STROKE_WIDTH = 96;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 256;
export const HISTORY_CAP = 100;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export type Hex = `#${string}`;

/** §4.0 — persisted stroke kinds. `select` is a UI tool, not a stroke. */
export type StrokeTool =
  | "rect"
  | "arrow"
  | "line"
  | "freehand"
  | "highlight"
  | "blur"
  | "text";

export interface StrokeStyle {
  color: Hex;
  width: number;
  opacity: number;
  dash?: number[] | null;
}

export interface StrokeBase {
  id: string;
  style: StrokeStyle;
  /** §10.6 — identity, not rank. A gap is intentional. */
  label?: number;
  createdAt: number;
}

export type RectStroke = StrokeBase & { tool: "rect"; rect: Rect; radius?: number };
export type ArrowStroke = StrokeBase & { tool: "arrow"; from: Point; to: Point };
export type LineStroke = StrokeBase & { tool: "line"; from: Point; to: Point };
export type FreehandStroke = StrokeBase & { tool: "freehand"; points: Point[] };
export type HighlightStroke = StrokeBase & { tool: "highlight"; rect: Rect };
export type BlurStroke = StrokeBase & {
  tool: "blur";
  rect: Rect;
  mode: "pixelate" | "blur";
  strength: number;
};
export type TextStroke = StrokeBase & {
  tool: "text";
  /** Leader-line tip. */
  anchor: Point;
  /** Chip top-left. The chip's rendered size is derived, never stored. */
  box: Point;
  text: string;
  fontSize: number;
  wrapWidth: number;
};

export type Stroke =
  | RectStroke
  | ArrowStroke
  | LineStroke
  | FreehandStroke
  | HighlightStroke
  | BlurStroke
  | TextStroke;

export interface LegendItem {
  label: number;
  text: string;
}

export interface CanvasLegend {
  enabled: boolean;
  items: LegendItem[];
}

export interface CropRegion {
  rect: Rect;
}

export interface CanvasDocument {
  /** === CANVAS_DOC_VERSION at write time. */
  version: number;
  /** `AssetDTO.id` of the INPUT_SCREENSHOT. */
  sourceAssetId: string;
  imageNaturalSize: Size;
  /** Paint order == array order; z-order is index. */
  strokes: Stroke[];
  /** Non-destructive, applied at export (§4.9). */
  crop?: CropRegion | null;
  legend?: CanvasLegend;
}

/** §6.2 — css = image * scale + t. Never serialised (§6.3). */
export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

export type LayerName = "base" | "ink" | "overlay";

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type ImageStatus = "idle" | "loading" | "ready" | "error";

/** §1.3 — frozen contract consumed by Doc 06. */
export interface ExportResult {
  asset: AssetDTO;
  document: CanvasDocument;
  sha256: string;
  byte_size: number;
  /** ISO-8601 UTC with `Z`. */
  exported_at: string;
}

export type LegibilityCode =
  | "THIN_STROKE"
  | "SMALL_TEXT"
  | "TEXT_OVERFLOW"
  | "LOW_OPACITY"
  | "LEGEND_MISMATCH"
  | "WEAK_BLUR";

/** §10.8 — non-blocking pre-export warnings. */
export interface LegibilityWarning {
  code: LegibilityCode;
  strokeId: string | null;
  message: string;
}

export interface AutosaveSnapshot {
  savedAt: string;
  doc: CanvasDocument;
}

export function isRectStroke(s: Stroke): s is RectStroke {
  return s.tool === "rect";
}
export function isArrowStroke(s: Stroke): s is ArrowStroke {
  return s.tool === "arrow";
}
export function isLineStroke(s: Stroke): s is LineStroke {
  return s.tool === "line";
}
export function isFreehandStroke(s: Stroke): s is FreehandStroke {
  return s.tool === "freehand";
}
export function isHighlightStroke(s: Stroke): s is HighlightStroke {
  return s.tool === "highlight";
}
export function isBlurStroke(s: Stroke): s is BlurStroke {
  return s.tool === "blur";
}
export function isTextStroke(s: Stroke): s is TextStroke {
  return s.tool === "text";
}

/** `rect`/`arrow`/`text` carry `[n]`; highlights and blurs never do (§10.6). */
export function isLabellableTool(tool: StrokeTool): boolean {
  return tool === "rect" || tool === "arrow" || tool === "text";
}
