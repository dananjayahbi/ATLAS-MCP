/**
 * The markup overlay's own document model.
 *
 * Deliberately separate from `lib/canvas` (Doc 07): that engine is a
 * review-grade annotation suite with callouts, blur, legend and a frozen wire
 * format. The operator's "mark things on the screenshot" flow needs pen +
 * eraser + pan/zoom, and reusing the heavy document would force a source-image
 * upload round-trip before the first stroke.
 *
 * All geometry is in **image-natural pixels**, so a 40 % preview and the final
 * burn-in agree exactly.
 */

export type MarkupTool = "pen" | "eraser";

export type MarkupPoint = { x: number; y: number };

export type MarkupStroke = {
  id: string;
  tool: "pen";
  color: string;
  width: number;
  points: MarkupPoint[];
};

/** Strokes are the only content; the eraser removes whole strokes. */
export type MarkupDocument = {
  strokes: MarkupStroke[];
  width: number;
  height: number;
};

export type MarkupView = {
  scale: number;
  tx: number;
  ty: number;
};

export const MARKUP_COLORS = ["#FF3B5C", "#FFB020", "#3BE38F", "#00F2FE", "#B48BFF", "#FFFFFF"] as const;
export const MARKUP_WIDTHS = [3, 6, 12, 20] as const;
export const DEFAULT_COLOR = MARKUP_COLORS[0];
export const DEFAULT_WIDTH = MARKUP_WIDTHS[1];

export function createMarkupDocument(width: number, height: number): MarkupDocument {
  return { strokes: [], width, height };
}

export function strokeCount(doc: MarkupDocument): number {
  return doc.strokes.length;
}
