import { createMarkupDocument, type MarkupDocument, type MarkupPoint, type MarkupStroke } from "./types";

export * from "./types";
export * from "./geometry";
export * from "./render";
export * from "./strokes";

/** Persisted alongside the flattened PNG so the markup survives a reload. */
export const MARKUP_DOC_VERSION = 1;

export type MarkupSnapshot = {
  version: number;
  stroke_count: number;
  strokes: MarkupStroke[];
};

export function toSnapshot(doc: MarkupDocument): MarkupSnapshot {  return { version: MARKUP_DOC_VERSION, stroke_count: doc.strokes.length, strokes: doc.strokes };
}

export function fromSnapshot(
  raw: unknown,
  fallback: { width: number; height: number },
): MarkupDocument {
  if (typeof raw !== "object" || raw === null) return createMarkupDocument(fallback.width, fallback.height);
  const record = raw as Record<string, unknown>;
  const strokes = Array.isArray(record.strokes) ? record.strokes : [];
  const parsed: MarkupStroke[] = [];
  for (const entry of strokes) {
    const stroke = parseStroke(entry);
    if (stroke) parsed.push(stroke);
  }
  return { strokes: parsed, width: fallback.width, height: fallback.height };
}

function parseStroke(raw: unknown): MarkupStroke | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  if (typeof record.color !== "string") return null;
  if (typeof record.width !== "number" || !Number.isFinite(record.width)) return null;
  if (!Array.isArray(record.points)) return null;
  const points: MarkupPoint[] = [];
  for (const point of record.points) {
    if (typeof point !== "object" || point === null) continue;
    const { x, y } = point as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }
  if (points.length === 0) return null;
  return { id: record.id, tool: "pen", color: record.color, width: record.width, points };
}

export type { MarkupTool } from "./types";
export type { MarkupStroke, MarkupPoint, MarkupView, MarkupDocument } from "./types";