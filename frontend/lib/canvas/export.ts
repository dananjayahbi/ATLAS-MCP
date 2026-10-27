/**
 * Doc 07 §9.1 / §9.2 — flatten the three layers into one PNG at
 * `imageNaturalSize` (or the crop rect), hash it, and build the multipart body.
 *
 * The export surface is always a fresh offscreen canvas at natural resolution,
 * never the on-screen layers, so screen DPR cannot contaminate the output and
 * blur regions are re-rasterised from the *original* bitmap (§4.8).
 */
import { intersectRect, selectionBBox, strokeBBox, type MeasureFn } from "./geometry";
import { CanvasError } from "./errors";
import {
  applyBlurRegion,
  drawCallout,
  drawFreehand,
  drawLabelChip,
  drawLegend,
  drawArrow,
  drawStroke,
  drawStrokeWithHalo,
  imageRectToCss,
  releaseScratch,
  type CalloutStyle,
} from "./render";
import {
  MAX_STROKE_WIDTH,
  MIN_FONT_SIZE,
  MIN_STROKE_WIDTH,
  type CanvasDocument,
  type ImageStatus,
  type LegibilityWarning,
  type Rect,
  type Size,
  type Stroke,
  type TextStroke,
} from "./types";

/** Doc 01 §14.5 / §9.4 — the upload cap is 25 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const EXPORT_FILENAME = "annotated_canvas.png";

export interface ComposeInput {
  doc: CanvasDocument;
  image: ImageBitmap | null;
  measure: MeasureFn;
  visionMode: boolean;
  showLegend: boolean;
}

export interface ComposeResult {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Bounds actually rendered (the crop rect when one is set). */
  bounds: Rect;
  fontClamped: boolean;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createSurface(width: number, height: number): { canvas: AnyCanvas; ctx: AnyCtx } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new CanvasError("EXPORT_ENCODE_FAILED", "2D context unavailable");
    return { canvas, ctx: ctx as AnyCtx };
  }
  if (typeof document === "undefined") {
    throw new CanvasError("EXPORT_ENCODE_FAILED", "No canvas implementation available");
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new CanvasError("EXPORT_ENCODE_FAILED", "2D context unavailable");
  return { canvas, ctx };
}

/** §9.1 — the compose order is frozen: image → blur → highlight → strokes. */
export function composeDocument(input: ComposeInput): ComposeResult {
  const { doc, image, measure, visionMode } = input;
  const bounds: Rect = doc.crop?.rect ?? {
    x: 0,
    y: 0,
    w: doc.imageNaturalSize.w,
    h: doc.imageNaturalSize.h,
  };
  const { canvas, ctx } = createSurface(bounds.w, bounds.h);
  const c2d = ctx as CanvasRenderingContext2D;
  let fontClamped = false;

  c2d.save();
  try {
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.fillStyle = "#030712";
    c2d.fillRect(0, 0, bounds.w, bounds.h);
    c2d.translate(-bounds.x, -bounds.y);

    if (image) {
      c2d.imageSmoothingEnabled = true;
      c2d.imageSmoothingQuality = "high";
      c2d.drawImage(
        image,
        0,
        0,
        doc.imageNaturalSize.w,
        doc.imageNaturalSize.h,
      );
    }

    // Step 3 — blur regions read the composite so overlaps never un-blur.
    // The export surface is at natural size with its origin at `bounds`, so the
    // source rect must be shifted into surface space while the destination stays
    // in image space (the context is already translated by `-bounds`).
    for (const stroke of doc.strokes) {
      if (stroke.tool !== "blur") continue;
      applyBlurRegion(c2d, {
        srcCanvas: canvas as unknown as CanvasImageSource,
        srcRect: {
          x: stroke.rect.x - bounds.x,
          y: stroke.rect.y - bounds.y,
          w: stroke.rect.w,
          h: stroke.rect.h,
        },
        destRect: stroke.rect,
        mode: stroke.mode,
        strength: stroke.strength,
        dpr: 1,
      });
    }

    // Step 4 — highlights multiply so overlaps do not saturate.
    for (const stroke of doc.strokes) {
      if (stroke.tool !== "highlight") continue;
      drawStroke(c2d, stroke, 1);
    }

    // Steps 5–6 — strokes in paint order, with optional vision halo.
    for (const stroke of doc.strokes) {
      if (stroke.tool === "highlight" || stroke.tool === "blur") continue;
      if (stroke.tool === "text") {
        const clamped = clampCalloutFont(stroke, doc.imageNaturalSize);
        if (clamped !== stroke) fontClamped = true;
        drawStrokeWithHalo(c2d, clamped, 1, visionMode);
        continue;
      }
      drawStrokeWithHalo(c2d, clampStrokeWidth(stroke), 1, visionMode);
    }

    // Step 7 — labels last so a number is never occluded.
    for (const stroke of doc.strokes) {
      if (typeof stroke.label !== "number") continue;
      if (stroke.tool === "highlight" || stroke.tool === "blur") continue;
      drawLabelChip(c2d, stroke, stroke.label, measure, doc.imageNaturalSize, 1);
    }

    // Step 8 — legend.
    if (input.showLegend && doc.legend?.enabled) {
      drawLegend(c2d, doc, measure, 1);
    }
  } finally {
    c2d.restore();
  }

  return { canvas, bounds, fontClamped };
}

/** §10.1 hard floor — nothing thinner than 3 image px ships. */
export function clampStrokeWidth(stroke: Stroke): Stroke {
  if (stroke.style.width >= MIN_STROKE_WIDTH) return stroke;
  return { ...stroke, style: { ...stroke.style, width: MIN_STROKE_WIDTH } };
}

/** §10.4 — the exporter renders below-floor text at the floor, never lower. */
export function calloutFontFloor(naturalWidth: number): number {
  if (naturalWidth >= 3_840) return naturalWidth >= 4_320 ? 18 : 16;
  return MIN_FONT_SIZE;
}

export function clampCalloutFont(stroke: TextStroke, image: Size): TextStroke {
  const floor = calloutFontFloor(image.w);
  if (stroke.fontSize >= floor) return stroke;
  return { ...stroke, fontSize: floor };
}

/* --------------------------------------------------------------- legibility */

/** §10.8 — non-blocking pre-export gate. */
export function checkLegibility(doc: CanvasDocument, measure: MeasureFn): LegibilityWarning[] {
  const warnings: LegibilityWarning[] = [];
  const naturalW = doc.imageNaturalSize.w;
  for (const stroke of doc.strokes) {
    if (stroke.style.width < MIN_STROKE_WIDTH) {
      warnings.push({
        code: "THIN_STROKE",
        strokeId: stroke.id,
        message: `Stroke width ${stroke.style.width} px is below the 3 px floor.`,
      });
    }
    if (stroke.tool !== "highlight" && stroke.style.opacity < 0.55) {
      warnings.push({
        code: "LOW_OPACITY",
        strokeId: stroke.id,
        message: "Opacity below 55 % reads as faint to a vision model.",
      });
    }
    if (stroke.tool === "text") {
      const floor = calloutFontFloor(naturalW);
      if (stroke.fontSize < floor) {
        warnings.push({
          code: "SMALL_TEXT",
          strokeId: stroke.id,
          message: `Callout font ${stroke.fontSize} px is below the ${floor} px floor.`,
        });
      }
      const lines = Math.max(1, Math.round(strokeBBox(stroke, measure).h / (stroke.fontSize * 1.3)));
      if (lines > 4) {
        warnings.push({
          code: "TEXT_OVERFLOW",
          strokeId: stroke.id,
          message: "Callout exceeds 4 rendered lines.",
        });
      }
    }
    if (stroke.tool === "blur" && stroke.strength < 8 && naturalW > 2_560) {
      warnings.push({
        code: "WEAK_BLUR",
        strokeId: stroke.id,
        message: "Blur block below 8 px is reversible on a high-resolution source.",
      });
    }
    if (stroke.style.width > MAX_STROKE_WIDTH) {
      warnings.push({
        code: "THIN_STROKE",
        strokeId: stroke.id,
        message: "Stroke width exceeds the renderable maximum and will be clamped.",
      });
    }
  }
  const labels = doc.strokes.filter((s) => typeof s.label === "number").length;
  const legendItems = doc.legend?.enabled ? (doc.legend.items.length ?? 0) : labels;
  if (doc.legend?.enabled && labels !== legendItems) {
    warnings.push({
      code: "LEGEND_MISMATCH",
      strokeId: null,
      message: `${labels} label(s) but ${legendItems} legend row(s).`,
    });
  }
  return warnings;
}

/* ------------------------------------------------------------------ encode */

export async function canvasToBlob(canvas: AnyCanvas): Promise<Blob> {
  if (isOffscreen(canvas)) {
    try {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      if (!blob) throw new CanvasError("EXPORT_ENCODE_FAILED");
      return blob;
    } catch (error) {
      throw error instanceof CanvasError
        ? error
        : new CanvasError("EXPORT_ENCODE_FAILED", undefined, { cause: error });
    }
  }
  const html = canvas;
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      html.toBlob((result) => resolve(result), "image/png");
    } catch (error) {
      // A SecurityError here means the canvas is tainted (§14.1).
      throw new CanvasError("EXPORT_TAINTED", undefined, { cause: error });
    }
  });
  if (!blob) throw new CanvasError("EXPORT_ENCODE_FAILED");
  return blob;
}

function isOffscreen(canvas: AnyCanvas): canvas is OffscreenCanvas {
  return typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas;
}

/** §9.2 — 64 lowercase hex chars. Never blocks the export. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!subtle) return null;
  try {
    const digest = await subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export const EMPTY_SHA256 = "0".repeat(64);

/* ----------------------------------------------------------------- upload body */

export interface UploadFields {
  task_id: string;
  kind: "ANNOTATED_CANVAS";
  source: "HUMAN";
  sha256: string;
  source_asset_id: string;
}

/** §9.3 — the exact, frozen field set. Never a path. */
export function buildUploadFields(
  taskId: string,
  doc: CanvasDocument,
  sha256: string,
): UploadFields {
  return {
    task_id: taskId,
    kind: "ANNOTATED_CANVAS",
    source: "HUMAN",
    sha256,
    source_asset_id: doc.sourceAssetId,
  };
}

export function buildMultipartBody(fields: UploadFields, blob: Blob): FormData {
  const form = new FormData();
  form.append("task_id", fields.task_id);
  form.append("kind", fields.kind);
  form.append("source", fields.source);
  form.append("sha256", fields.sha256);
  form.append("source_asset_id", fields.source_asset_id);
  form.append("file", blob, EXPORT_FILENAME);
  return form;
}

/* ------------------------------------------------------------------ result */

export interface RasterisedExport {
  blob: Blob;
  sha256: string;
  byte_size: number;
  width: number;
  height: number;
  fontClamped: boolean;
}

/**
 * Full pipeline: compose → encode → hash. Throws `CanvasError` only; the
 * caller turns that into an `onError` payload.
 */
export async function rasteriseExport(
  input: ComposeInput,
  options: { maxBytes?: number } = {},
): Promise<RasterisedExport> {
  const { canvas, bounds, fontClamped } = composeDocument(input);
  const cap = options.maxBytes ?? MAX_UPLOAD_BYTES;
  try {
    const blob = await canvasToBlob(canvas);
    if (blob.size > cap) {
      throw new CanvasError(
        "EXPORT_TOO_LARGE",
        `Export is ${(blob.size / 1024 / 1024).toFixed(1)} MB; limit ${(cap / 1024 / 1024).toFixed(0)} MB.`,
      );
    }
    const buffer = await blob.arrayBuffer();
    const hash = await sha256Hex(buffer);
    return {
      blob,
      sha256: hash ?? EMPTY_SHA256,
      byte_size: blob.size,
      width: Math.round(bounds.w),
      height: Math.round(bounds.h),
      fontClamped,
    };
  } finally {
    releaseSurface(canvas);
    releaseScratch();
  }
}

/** §11.2 — release the transient export surface immediately after encode. */
export function releaseSurface(canvas: AnyCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

/* ---------------------------------------------------------------- leftovers */

export interface OverlayHint {
  bbox: Rect | null;
}

export function documentBounds(doc: CanvasDocument, measure: MeasureFn): OverlayHint {
  return { bbox: selectionBBox(doc.strokes, measure) };
}

/** Kept for callers that need the css⇄image helper without importing render. */
export { imageRectToCss, drawArrow, drawFreehand, drawCallout };
export type { CalloutStyle, ImageStatus };

/** §4.9 — a stroke fully outside the crop is silently dropped from the export. */
export function clipToBounds(rect: Rect, bounds: Rect): Rect | null {
  return intersectRect(rect, bounds);
}
