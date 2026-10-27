"use client";

/**
 * Doc 07 §2.3 — the single mutable scene the render loop reads.
 *
 * The `CanvasDocument` is the model; this object holds the ephemeral projection
 * (view transform, selection, preview, hover) that must never trigger a React
 * re-render on every pointer move (§2.2).
 */
import type {
  CanvasDocument,
  ImageStatus,
  LayerName,
  Point,
  Rect,
  Size,
  Stroke,
  ViewTransform,
} from "@/lib/canvas/types";

export interface Scene {
  doc: CanvasDocument;
  view: ViewTransform;
  fit: number;
  container: Size;
  dpr: number;
  image: ImageBitmap | null;
  imageStatus: ImageStatus;
  selection: Set<string>;
  hoveredId: string | null;
  marquee: Rect | null;
  previewStroke: Stroke | null;
  previewBlur: Rect | null;
  cursor: Point | null;
  keyboardCursor: Point | null;
  pointerDown: boolean;
  visionMode: boolean;
  showLegend: boolean;
  spacePan: boolean;
  reviewMode: boolean;
}

export function createScene(input: {
  doc: CanvasDocument;
  visionMode: boolean;
  showLegend: boolean;
  reviewMode: boolean;
}): Scene {
  return {
    doc: input.doc,
    view: { scale: 1, tx: 0, ty: 0 },
    fit: 1,
    container: { w: 0, h: 0 },
    dpr: 1,
    image: null,
    imageStatus: "idle",
    selection: new Set<string>(),
    hoveredId: null,
    marquee: null,
    previewStroke: null,
    previewBlur: null,
    cursor: null,
    keyboardCursor: null,
    pointerDown: false,
    visionMode: input.visionMode,
    showLegend: input.showLegend,
    spacePan: false,
    reviewMode: input.reviewMode,
  };
}

export function clearTransient(scene: Scene): void {
  scene.marquee = null;
  scene.previewStroke = null;
  scene.previewBlur = null;
  scene.hoveredId = null;
}

export type Invalidate = (layer?: LayerName | "all") => void;
