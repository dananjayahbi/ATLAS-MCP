/**
 * Doc 07 §12.3 — human-readable stroke descriptions for the a11y tree and for
 * status announcements. Pure functions, no DOM.
 */
import { isTextStroke, type Stroke } from "@/lib/canvas/types";

const TOOL_NOUN: Record<Stroke["tool"], string> = {
  rect: "Rectangle",
  arrow: "Arrow",
  line: "Line",
  freehand: "Freehand",
  highlight: "Highlight",
  blur: "Blur",
  text: "Callout",
};

function round(n: number): number {
  return Math.round(n);
}

export function describeStroke(stroke: Stroke): string {
  const prefix = typeof stroke.label === "number" ? `[${stroke.label}] ` : "";
  switch (stroke.tool) {
    case "rect":
    case "highlight":
    case "blur":
      return `${prefix}${TOOL_NOUN[stroke.tool]} at ${round(stroke.rect.x)}, ${round(stroke.rect.y)}, ${round(
        stroke.rect.w,
      )} by ${round(stroke.rect.h)}`;
    case "line":
    case "arrow":
      return `${prefix}${TOOL_NOUN[stroke.tool]} from ${round(stroke.from.x)}, ${round(stroke.from.y)} to ${round(
        stroke.to.x,
      )}, ${round(stroke.to.y)}`;
    case "freehand":
      return `${TOOL_NOUN.freehand} with ${stroke.points.length} points`;
    case "text":
      return `${prefix}${TOOL_NOUN.text} "${truncate(stroke.text, 60)}" at ${round(stroke.anchor.x)}, ${round(
        stroke.anchor.y,
      )}`;
    default:
      return "Annotation";
  }
}

export function describeSelection(strokes: Stroke[]): string {
  if (strokes.length === 0) return "Nothing selected";
  if (strokes.length === 1) return describeStroke(strokes[0]);
  return `${strokes.length} annotations selected`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function isCallout(stroke: Stroke): boolean {
  return isTextStroke(stroke);
}
