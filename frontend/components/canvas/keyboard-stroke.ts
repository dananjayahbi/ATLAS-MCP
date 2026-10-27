"use client";

/**
 * Doc 07 §12.1 — the keyboard-sourced stroke factory. It must produce the
 * exact same `Stroke` geometry as the pointer flow, so it shares `makeId`,
 * `nextLabel` and the style defaults rather than re-deriving them.
 */
import { makeId } from "@/lib/canvas/document";
import type { EditorTool } from "@/lib/canvas/tools";
import type { Point, Rect, Stroke, StrokeStyle } from "@/lib/canvas/types";

/** §12.1 — the preview uses the same geometry as the committed stroke. */
export function previewForRect(
  tool: EditorTool,
  rect: Rect,
  style: StrokeStyle,
): Stroke | null {
  if (rect.w < 1 || rect.h < 1) return null;
  if (tool === "blur") return null; // previewed as a base-layer blur hint
  if (tool === "arrow" || tool === "line") {
    return {
      id: "preview-kbd",
      tool,
      style,
      createdAt: 0,
      from: { x: rect.x, y: rect.y },
      to: { x: rect.x + rect.w, y: rect.y + rect.h },
    };
  }
  if (tool === "highlight") {
    return { id: "preview-kbd", tool: "highlight", style: { ...style, opacity: 0.28 }, createdAt: 0, rect };
  }
  return { id: "preview-kbd", tool: "rect", style, createdAt: 0, rect };
}

export interface KeyboardStrokeInput {
  tool: EditorTool;
  from: Point;
  to: Point;
  rect: Rect;
  style: StrokeStyle;
  label?: number;
  blurMode?: "pixelate" | "blur";
  blurStrength?: number;
}
export function buildKeyboardStroke(input: KeyboardStrokeInput): Stroke {
  const { tool, from, to, rect, style, label, blurMode = "pixelate", blurStrength = 12 } = input;
  const base = { id: makeId(), style: { ...style, dash: null }, createdAt: Date.now() };
  const labelled = label === undefined ? {} : { label };
  switch (tool) {
    case "arrow":
    case "line":
      return { ...base, tool, from, to, ...labelled };
    case "blur":
      return { ...base, tool: "blur", rect, mode: blurMode, strength: blurStrength };
    case "highlight":
      return { ...base, tool: "highlight", rect, style: { ...base.style, opacity: 0.28 } };
    case "pen":
      return { ...base, tool: "freehand", points: [from, to] };
    default:
      return { ...base, tool: "rect", rect, radius: 0, ...labelled };
  }
}
