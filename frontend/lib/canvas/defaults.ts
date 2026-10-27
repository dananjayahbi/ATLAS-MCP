/**
 * Doc 07 §10 — vision-legibility defaults.
 *
 * Widths and fonts are derived from the image's natural width so the same
 * annotation reads identically at 1080p and 4K (§10.1, §10.4).
 */
import { HIGHLIGHT_DEFAULT } from "./render";
import {
  MIN_FONT_SIZE,
  MIN_STROKE_WIDTH,
  type Hex,
  type Size,
  type StrokeStyle,
} from "./types";
import type { EditorTool } from "./tools";

export const DEFAULT_ANNOTATION_COLOR = "#FF2D55" as Hex;
export const SECONDARY_ANNOTATION_COLOR = "#00F2FE" as Hex;
export const PRIVACY_COLOR = "#F59E0B" as Hex;
export const HIGHLIGHT_COLOR = HIGHLIGHT_DEFAULT as Hex;

/** §10.2 — the palette the style panel offers; every entry is contract-frozen. */
export const PALETTE: readonly Hex[] = [
  DEFAULT_ANNOTATION_COLOR,
  SECONDARY_ANNOTATION_COLOR,
  PRIVACY_COLOR,
  "#10B981",
  HIGHLIGHT_COLOR,
  "#F8FAFC",
];

/** §10.1 — `clamp(round(naturalW / 720), 3, 24)`. */
export function defaultStrokeWidth(naturalWidth: number): number {
  return Math.min(24, Math.max(MIN_STROKE_WIDTH, Math.round(naturalWidth / 720)));
}

/** §10.4 — `clamp(round(naturalW / 180), 14, 96)`. */
export function defaultFontSize(naturalWidth: number): number {
  return Math.min(96, Math.max(14, Math.round(naturalWidth / 180)));
}

/** §4.8 — `max(8, round(naturalW / 480))` for pixelate blocks. */
export function defaultBlurStrength(naturalWidth: number, mode: "pixelate" | "blur"): number {
  if (mode === "blur") return Math.max(6, Math.round(naturalWidth / 400));
  return Math.max(8, Math.round(naturalWidth / 480));
}

export function defaultWrapWidth(image: Size): number {
  return Math.max(120, Math.round(image.w * 0.22));
}

export function defaultCalloutOffset(image: Size, anchor: { x: number; y: number }): { x: number; y: number } {
  const offset = { x: 28, y: -72 };
  const flippedX = anchor.x > image.w - defaultWrapWidth(image) - 64;
  const flippedY = anchor.y < 96;
  return {
    x: flippedX ? anchor.x - defaultWrapWidth(image) - 28 : anchor.x + offset.x,
    y: flippedY ? anchor.y + 40 : anchor.y + offset.y,
  };
}

export function styleForTool(
  tool: EditorTool,
  image: Size,
  base: { color: Hex; width: number; opacity: number },
): StrokeStyle {
  if (tool === "highlight") {
    return {
      color: HIGHLIGHT_COLOR,
      width: Math.max(MIN_STROKE_WIDTH, Math.round(defaultStrokeWidth(image.w) * 1.5)),
      opacity: 0.28,
      dash: null,
    };
  }
  if (tool === "blur") {
    return { color: PRIVACY_COLOR, width: base.width, opacity: 1, dash: null };
  }
  return {
    color: base.color,
    width: Math.max(MIN_STROKE_WIDTH, Math.round(base.width)),
    opacity: Math.min(Math.max(base.opacity, 0.55), 1),
    dash: null,
  };
}

/** §10.6 — labels only auto-assign to rect, arrow and text. */
export function shouldAutoLabel(tool: EditorTool): boolean {
  return tool === "rect" || tool === "arrow" || tool === "text";
}
