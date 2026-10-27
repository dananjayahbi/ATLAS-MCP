"use client";

/**
 * Doc 07 §10.7 — legend row descriptions and nudge coalescing helpers.
 * Pure functions so the engine hook stays about wiring.
 */
import { TOOL_META } from "@/lib/canvas/tools";
import type { MoveCommand, StrokeState } from "@/lib/canvas/strokes";
import { NUDGE_COALESCE_MS } from "@/lib/canvas/strokes";
import type { Stroke } from "@/lib/canvas/types";

/** Auto descriptor used when the user has not typed legend text (§10.7). */
export function describeForLegend(stroke: Stroke): string {
  switch (stroke.tool) {
    case "rect":
      return `region (${Math.round(stroke.rect.w)} × ${Math.round(stroke.rect.h)})`;
    case "arrow":
      return `pointer to ${Math.round(stroke.to.x)}, ${Math.round(stroke.to.y)}`;
    case "line":
      return "alignment line";
    case "text":
      return stroke.text;
    case "freehand":
      return TOOL_META.pen.name.toLowerCase();
    default:
      return TOOL_META.rect.name.toLowerCase();
  }
}

/**
 * §8.3 — consecutive nudges of the same selection inside 600 ms become one
 * history entry. Returns the merged command, or `null` when the new command
 * must stand alone.
 */
export function mergeNudge(
  state: StrokeState,
  next: MoveCommand,
  at: number,
): MoveCommand | null {
  if (at - state.lastCommandAt > NUDGE_COALESCE_MS) return null;
  const previous = state.undo[state.undo.length - 1];
  if (!previous || previous.kind !== "move") return null;
  if (previous.strokes.length !== next.strokes.length) return null;
  const prevById = new Map(previous.strokes.map((s) => [s.id, s]));
  const strokes: MoveCommand["strokes"] = [];
  for (const entry of next.strokes) {
    const earlier = prevById.get(entry.id);
    if (!earlier) return null;
    strokes.push({ id: entry.id, prev: earlier.prev, next: entry.next });
  }
  return { kind: "move", label: previous.label, strokes };
}
