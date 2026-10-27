/**
 * Doc 07 §5 — drawing routines for the three layers.
 *
 * Layer responsibilities (§2.1):
 *   base    image + blur/pixelate regions + crop scrim
 *   ink     strokes, callouts, labels, legend
 *   overlay handles, marquee, preview, crosshair, keyboard cursor
 *
 * Rules (§5.2): every state-mutating function opens with `save()` and closes
 * with `restore()` in `finally`; the transform is only ever set by the caller.
 */
import { CanvasError } from "./errors";
import { calloutChipRect, calloutLeaderStart, wrapCalloutText, selectionBBox, strokeBBox, type MeasureFn } from "./geometry";

/** Re-exported before first use so renderers and callers share one type. */
export type { MeasureFn };
import {
  type CanvasDocument,
  type ImageStatus,
  type Point,
  type Rect,
  type Size,
  type Stroke,
  type TextStroke,
  type ViewTransform,
} from "./types";

/* ------------------------------------------------------------------- fonts */

export const CHIP_BG = "#0B1528";
export const CHIP_TEXT = "#F8FAFC";
export const HALO_COLOR = "#FFFFFF";
export const LEGEND_BORDER = "#00F2FE";
export const FOCUS_RING = "#00F2FE";
export const HIGHLIGHT_DEFAULT = "#FFD60A";

/** §10.2 — frozen chip/glyph colours; these are image content, not chrome. */
export function calloutFontString(fontSize: number): string {
  return `600 ${fontSize}px "JetBrains Mono", "Geist Mono", ui-monospace, monospace`;
}

/**
 * Measurement backed by a detached 1×1 canvas. Falls back to an approximate
 * character-width model when no DOM is available (SSR, unit tests).
 */
export function createMeasureFn(): MeasureFn {
  if (typeof document === "undefined") {
    return (text: string, _font: string) => text.length * 0.6 * parseFontSize(_font);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return (text: string, _font: string) => text.length * 0.6 * parseFontSize(_font);
  }
  return (text: string, font: string) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

function parseFontSize(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : 14;
}

/* --------------------------------------------------------------- primitives */

/** §10.3 — white halo drawn underneath so a stroke reads on any background. */
export function drawStrokeWithHalo(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number,
  visionMode: boolean,
): void {
  if (!visionMode) {
    drawStroke(ctx, stroke, scale);
    return;
  }
  ctx.save();
  try {
    ctx.globalAlpha = 0.9;
    drawStroke(ctx, stroke, scale, { color: HALO_COLOR, width: stroke.style.width + 6, opacity: 0.9 });
  } finally {
    ctx.restore();
  }
  drawStroke(ctx, stroke, scale);
}

export interface StyleOverride {
  color?: string;
  width?: number;
  opacity?: number;
}

/** §5.4 — `S` = image-natural px → target px (1 at export). */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  S: number,
  override?: StyleOverride,
): void {
  if (stroke.tool === "blur") return; // composited on the base pass (§5.1 step 3)
  const color = override?.color ?? stroke.style.color;
  const width = override?.width ?? stroke.style.width;
  const opacity = override?.opacity ?? stroke.style.opacity;
  ctx.save();
  try {
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(0.75, width * S);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(stroke.style.dash ?? []);
    switch (stroke.tool) {
      case "rect":
      case "highlight": {
        const r = scaleRect(stroke.rect, S);
        if (stroke.tool === "highlight") {
          ctx.globalCompositeOperation = "multiply";
          ctx.globalAlpha = Math.min(stroke.style.opacity, 0.35);
          ctx.fillStyle = color;
          ctx.fillRect(r.x, r.y, r.w, r.h);
          break;
        }
        ctx.beginPath();
        const radius = (stroke.radius ?? 0) * S;
        if (radius > 0 && typeof ctx.roundRect === "function") {
          ctx.roundRect(r.x, r.y, r.w, r.h, radius);
        } else {
          ctx.rect(r.x, r.y, r.w, r.h);
        }
        ctx.stroke();
        break;
      }
      case "line": {
        const a = scalePoint(stroke.from, S);
        const b = scalePoint(stroke.to, S);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        break;
      }
      case "arrow": {
        const a = scalePoint(stroke.from, S);
        const b = scalePoint(stroke.to, S);
        drawArrow(ctx, a, b, Math.max(3.2 * ctx.lineWidth, 14 * S));
        break;
      }
      case "freehand": {
        drawFreehand(ctx, stroke.points, S, stroke.style.width * S);
        break;
      }
      case "text":
        drawCallout(ctx, stroke, S, { color, opacity });
        break;
      default:
        break;
    }
  } finally {
    ctx.restore();
  }
}

/** §10.5 — filled 90° head; the shaft stops `0.85 × head` short of the tip. */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  headRequested: number,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return;
  const head = Math.min(headRequested, length * 0.6);
  const angle = Math.atan2(dy, dx);
  const kx = Math.cos(angle);
  const ky = Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x - kx * head * 0.85, b.y - ky * head * 0.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 4), b.y - head * Math.sin(angle - Math.PI / 4));
  ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 4), b.y - head * Math.sin(angle + Math.PI / 4));
  ctx.closePath();
  ctx.fill();
}

/** §4.5 — quadratic smoothing through midpoints, one `stroke()` call. */
export function drawFreehand(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  S: number,
  lineWidth: number,
): void {
  if (points.length === 0) return;
  if (points.length === 1) {
    const p = scalePoint(points[0], S);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.75, lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x * S, points[0].y * S);
  for (let i = 1; i < points.length - 1; i += 1) {
    const c = points[i];
    const n = points[i + 1];
    ctx.quadraticCurveTo(c.x * S, c.y * S, ((c.x + n.x) / 2) * S, ((c.y + n.y) / 2) * S);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x * S, last.y * S);
  ctx.stroke();
}

export interface CalloutStyle {
  color: string;
  opacity: number;
}

/** §5.5 — leader → anchor dot → chip → border → glyphs. */
export function drawCallout(
  ctx: CanvasRenderingContext2D,
  stroke: TextStroke,
  S: number,
  style: CalloutStyle,
): void {
  const measure = measureFor(ctx);
  const chipImage = calloutChipRect(stroke, measure);
  const chip = scaleRect(chipImage, S);
  const anchor = scalePoint(stroke.anchor, S);
  const start = scalePoint(calloutLeaderStart(chipImage, stroke.anchor), S);
  const fontSize = stroke.fontSize * S;

  ctx.save();
  try {
    if (Math.hypot(anchor.x - start.x, anchor.y - start.y) > 1) {
      ctx.globalAlpha = style.opacity;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = Math.max(2, 2 * S);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(anchor.x, anchor.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, Math.max(2, 3 * S), 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1; // §10.2 — the chip must be fully opaque
    ctx.fillStyle = CHIP_BG;
    roundRectPath(ctx, chip, Math.max(2, 4 * S));
    ctx.fill();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(1, 2 * S);
    ctx.stroke();

    const lines = wrapCalloutText(stroke.text, stroke.fontSize, stroke.wrapWidth, measure);
    ctx.fillStyle = CHIP_TEXT;
    ctx.font = calloutFontString(fontSize);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const padX = stroke.fontSize * 0.6 * S;
    const padY = stroke.fontSize * 0.5 * S;
    const lineHeight = stroke.fontSize * 1.3 * S;
    lines.forEach((line, index) => {
      ctx.fillText(line, chip.x + padX, chip.y + padY + index * lineHeight);
    });
  } finally {
    ctx.restore();
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  ctx.beginPath();
  if (radius > 0 && typeof ctx.roundRect === "function") {
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
  } else {
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
  }
}

/* ------------------------------------------------------------------- base */

export interface BaseRenderInput {
  ctx: CanvasRenderingContext2D;
  css: Size;
  view: ViewTransform;
  doc: CanvasDocument;
  image: ImageBitmap | null;
  imageStatus: ImageStatus;
  dpr: number;
  /** §4.9 — dim everything outside the crop while editing. */
  dimOutsideCrop: boolean;
  /** §11.3 — a blur region being dragged previews on the base layer. */
  previewBlur?: Rect | null;
}

/** §5.1 steps 1–3 + the crop scrim. */
export function drawBase(input: BaseRenderInput): void {
  const { ctx, css, view, doc, image } = input;
  ctx.save();
  try {
    clearDevice(ctx);
    ctx.setTransform(input.dpr, 0, 0, input.dpr, 0, 0);
    ctx.fillStyle = "rgba(3,7,18,1)";
    ctx.fillRect(0, 0, css.w, css.h);

    if (!image) {
      drawSourcePlaceholder(ctx, css, input.imageStatus);
      return;
    }

    const dest: Rect = {
      x: view.tx,
      y: view.ty,
      w: doc.imageNaturalSize.w * view.scale,
      h: doc.imageNaturalSize.h * view.scale,
    };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, dest.x, dest.y, dest.w, dest.h);

    // Blur regions read the already-composited surface so overlaps never un-blur.
    for (const stroke of doc.strokes) {
      if (stroke.tool !== "blur") continue;
      applyBlurRegion(ctx, {
        srcCanvas: ctx.canvas,
        srcRect: {
          x: dest.x + stroke.rect.x * view.scale,
          y: dest.y + stroke.rect.y * view.scale,
          w: stroke.rect.w * view.scale,
          h: stroke.rect.h * view.scale,
        },
        destRect: {
          x: dest.x + stroke.rect.x * view.scale,
          y: dest.y + stroke.rect.y * view.scale,
          w: stroke.rect.w * view.scale,
          h: stroke.rect.h * view.scale,
        },
        mode: stroke.mode,
        strength: stroke.strength * view.scale,
        dpr: input.dpr,
      });
    }

    if (input.previewBlur) {
      const r: Rect = {
        x: dest.x + input.previewBlur.x * view.scale,
        y: dest.y + input.previewBlur.y * view.scale,
        w: input.previewBlur.w * view.scale,
        h: input.previewBlur.h * view.scale,
      };
      applyBlurRegion(ctx, {
        srcCanvas: ctx.canvas,
        srcRect: r,
        destRect: r,
        mode: "pixelate",
        strength: Math.max(2, 8 * view.scale),
        dpr: input.dpr,
      });
    }

    if (input.dimOutsideCrop && doc.crop) {
      drawCropScrim(ctx, css, view, doc.crop.rect);
    }
  } finally {
    ctx.restore();
  }
}

function drawSourcePlaceholder(
  ctx: CanvasRenderingContext2D,
  css: Size,
  status: ImageStatus,
): void {
  const label =
    status === "error"
      ? "SOURCE UNAVAILABLE"
      : status === "loading"
        ? "LOADING SOURCE…"
        : "NO SOURCE";
  ctx.save();
  try {
    ctx.strokeStyle = "rgba(90,107,132,0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(0.5, 0.5, Math.max(0, css.w - 1), Math.max(0, css.h - 1));
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(226,232,240,0.72)";
    ctx.font = `600 12px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, css.w / 2, css.h / 2);
  } finally {
    ctx.restore();
  }
}

/** §4.9 — everything outside the crop at 35 % opacity with a dark scrim. */
export function drawCropScrim(
  ctx: CanvasRenderingContext2D,
  css: Size,
  view: ViewTransform,
  crop: Rect,
): void {
  const r: Rect = {
    x: view.tx + crop.x * view.scale,
    y: view.ty + crop.y * view.scale,
    w: crop.w * view.scale,
    h: crop.h * view.scale,
  };
  ctx.save();
  try {
    ctx.fillStyle = "rgba(3,7,18,0.62)";
    ctx.beginPath();
    ctx.rect(0, 0, css.w, css.h);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill("evenodd");
    ctx.strokeStyle = "#00F2FE";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
    ctx.setLineDash([]);
  } finally {
    ctx.restore();
  }
}

export interface BlurRegionInput {
  /** Surface that already holds the pixels to destroy. */
  srcCanvas: CanvasImageSource;
  srcRect: Rect;
  destRect: Rect;
  mode: "pixelate" | "blur";
  strength: number;
  dpr: number;
}

/**
 * §4.8 — pixelate (default, irreversible) or gaussian. Reads from `srcCanvas`
 * so a second region over the first reads the already-destroyed pixels.
 */
export function applyBlurRegion(
  ctx: CanvasRenderingContext2D,
  input: BlurRegionInput,
): void {
  const { srcRect, destRect } = input;
  if (srcRect.w < 1 || srcRect.h < 1 || destRect.w < 1 || destRect.h < 1) return;
  ctx.save();
  try {
    if (input.mode === "blur") {
      ctx.filter = `blur(${Math.max(1, input.strength)}px)`;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        input.srcCanvas,
        srcRect.x * input.dpr,
        srcRect.y * input.dpr,
        srcRect.w * input.dpr,
        srcRect.h * input.dpr,
        destRect.x,
        destRect.y,
        destRect.w,
        destRect.h,
      );
      ctx.filter = "none";
      return;
    }
    const block = Math.max(2, input.strength);
    let cols = Math.max(1, Math.floor(destRect.w / block));
    let rows = Math.max(1, Math.floor(destRect.h / block));
    // §4.8 — block clamped so a region smaller than 2×block still blurs.
    const minDim = Math.min(destRect.w, destRect.h);
    if (block * 2 > minDim) {
      const clamped = Math.max(1, Math.floor(minDim / 2));
      cols = Math.max(1, Math.floor(destRect.w / clamped));
      rows = Math.max(1, Math.floor(destRect.h / clamped));
    }
    const scratch = acquireScratch(cols, rows);
    const sctx = scratch.ctx;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, cols, rows);
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(
      input.srcCanvas,
      srcRect.x * input.dpr,
      srcRect.y * input.dpr,
      Math.max(1, srcRect.w * input.dpr),
      Math.max(1, srcRect.h * input.dpr),
      0,
      0,
      cols,
      rows,
    );
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch.canvas, 0, 0, cols, rows, destRect.x, destRect.y, destRect.w, destRect.h);
    ctx.imageSmoothingEnabled = true;
  } finally {
    ctx.restore();
  }
}

/* -------------------------------------------------------------- scratch mgmt */

interface ScratchSurface {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

let scratch: ScratchSurface | null = null;

/** §11.2 — one reusable scratch surface, grown as needed, never one per region. */
function acquireScratch(w: number, h: number): ScratchSurface {
  const needW = Math.max(1, Math.ceil(w));
  const needH = Math.max(1, Math.ceil(h));
  if (
    scratch &&
    scratch.canvas.width >= needW &&
    scratch.canvas.height >= needH
  ) {
    return scratch;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(needW, needH);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new CanvasError("EXPORT_ENCODE_FAILED", "2D context unavailable");
    scratch = { canvas, ctx };
    return scratch;
  }
  const canvas = document.createElement("canvas");
  canvas.width = needW;
  canvas.height = needH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new CanvasError("EXPORT_ENCODE_FAILED", "2D context unavailable");
  scratch = { canvas, ctx };
  return scratch;
}

export function releaseScratch(): void {
  if (scratch) {
    scratch.canvas.width = 0;
    scratch.canvas.height = 0;
  }
  scratch = null;
}

/* -------------------------------------------------------------------- ink */

export interface InkRenderInput {
  ctx: CanvasRenderingContext2D;
  css: Size;
  view: ViewTransform;
  doc: CanvasDocument;
  dpr: number;
  measure: MeasureFn;
  visionMode: boolean;
  showLegend: boolean;
  /** In-progress strokes already committed to the model but not yet final. */
  hiddenIds?: Set<string>;
}

/**
 * §5.1 steps 4–8: highlights, then strokes in paint order, then labels, then
 * the legend. Blurs are skipped — they live on the base layer.
 */
export function drawInk(input: InkRenderInput): void {
  const { ctx, css, view, doc, dpr, measure, visionMode } = input;
  const S = view.scale;
  ctx.save();
  try {
    clearDevice(ctx);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Translation only: widths/lengths are scaled explicitly by `S` inside
    // `drawStroke`, so no transform ever scales a `lineWidth` (§6.4).
    ctx.translate(view.tx, view.ty);

    ctx.save();
    try {
      for (const stroke of doc.strokes) {
        if (stroke.tool !== "highlight") continue;
        if (input.hiddenIds?.has(stroke.id)) continue;
        drawStroke(ctx, stroke, S);
      }
    } finally {
      ctx.restore();
    }

    for (const stroke of doc.strokes) {
      if (stroke.tool === "highlight" || stroke.tool === "blur") continue;
      if (input.hiddenIds?.has(stroke.id)) continue;
      drawStrokeWithHalo(ctx, stroke, S, visionMode);
    }

    for (const stroke of doc.strokes) {
      if (input.hiddenIds?.has(stroke.id)) continue;
      const label = stroke.label;
      if (typeof label !== "number") continue;
      drawLabelChip(ctx, stroke, label, measure, doc.imageNaturalSize, S);
    }

    if (input.showLegend && doc.legend?.enabled) {
      drawLegend(ctx, doc, measure, S);
    }
  } finally {
    ctx.restore();
  }
}

/** §10.6 — `[n]` chip above the bbox, flipped inside near the image edge. */
export function drawLabelChip(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  label: number,
  measure: MeasureFn,
  image: Size,
  S: number,
): void {
  const bbox = strokeBBox(stroke, measure);
  const fontSize = Math.max(12, Math.min(96, image.w / 180)) * S;
  const text = `[${label}]`;
  const font = calloutFontString(fontSize);
  const textW = measure(text, font);
  const pad = fontSize * 0.35;
  const h = fontSize * 1.55;
  const w = textW + pad * 2;
  const scaled = imageRectToCss(bbox, { scale: S, tx: 0, ty: 0 });
  let x = scaled.x;
  let y = scaled.y - h - 4 * S;
  const maxW = image.w * S;
  const maxH = image.h * S;
  if (y < 0) y = scaled.y + scaled.h + 4 * S;
  if (y + h > maxH) y = Math.max(0, maxH - h);
  if (x + w > maxW) x = Math.max(0, maxW - w);
  if (x < 0) x = 0;
  if (y < 0) y = 0;

  ctx.save();
  try {
    ctx.globalAlpha = 1;
    ctx.fillStyle = CHIP_BG;
    roundRectPath(ctx, { x, y, w, h }, 4 * S);
    ctx.fill();
    ctx.strokeStyle = HALO_COLOR;
    ctx.lineWidth = Math.max(1, 2 * S);
    ctx.stroke();
    ctx.fillStyle = CHIP_TEXT;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2 + fontSize * 0.04);
  } finally {
    ctx.restore();
  }
}

/** §10.7 — legend block, bottom-left unless that quadrant is busy. */
export function drawLegend(
  ctx: CanvasRenderingContext2D,
  doc: CanvasDocument,
  measure: MeasureFn,
  S: number,
): void {
  const items = doc.legend?.items ?? [];
  if (items.length === 0) return;
  const image = doc.imageNaturalSize;
  const fontSize = Math.max(14, image.w / 220) * S;
  const font = calloutFontString(fontSize);
  const pad = fontSize * 0.7;
  const lineHeight = fontSize * 1.45;
  const rows = items.map((item) => `[${item.label}] ${item.text}`);
  const widest = rows.reduce((max, row) => Math.max(max, measure(row, font)), 0);
  const w = Math.min(image.w * S * 0.42, widest + pad * 2);
  const h = rows.length * lineHeight + pad * 2;
  const inset = 16 * S;
  const bbox = selectionBBox(doc.strokes, measure);
  const leftBusy = bbox ? bbox.x < image.w * 0.5 && bbox.y + bbox.h > image.h * 0.6 : false;
  const x = leftBusy ? Math.max(inset, image.w * S - w - inset) : inset;
  const y = Math.max(inset, image.h * S - h - inset);

  ctx.save();
  try {
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = CHIP_BG;
    roundRectPath(ctx, { x, y, w, h }, 3 * S);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = LEGEND_BORDER;
    ctx.lineWidth = Math.max(1, S);
    ctx.stroke();
    ctx.fillStyle = CHIP_TEXT;
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    rows.forEach((row, index) => {
      const clipped =
        measure(row, font) > w - pad * 2 ? truncateToWidth(row, w - pad * 2, font, measure) : row;
      ctx.fillText(clipped, x + pad, y + pad + index * lineHeight);
    });
  } finally {
    ctx.restore();
  }
}

function truncateToWidth(text: string, maxWidth: number, font: string, measure: MeasureFn): string {
  if (measure(text, font) <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && measure(`${trimmed}…`, font) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

/* ---------------------------------------------------------------- overlay */

export interface PreviewShape {
  kind: "rect" | "blur" | "highlight" | "ellipse";
  rect: Rect;
}

export interface OverlayRenderInput {
  ctx: CanvasRenderingContext2D;
  css: Size;
  view: ViewTransform;
  dpr: number;
  doc: CanvasDocument;
  measure: MeasureFn;
  selection: ReadonlySet<string>;
  hoveredId: string | null;
  marquee: Rect | null;
  previewStroke: Stroke | null;
  previewBlur: Rect | null;
  cursor: Point | null;
  keyboardCursor: Point | null;
  showHandles: boolean;
  pointerDown: boolean;
}

/** §2.1 — handles, marquee, in-progress preview, crosshair, keyboard cursor. */
export function drawOverlay(input: OverlayRenderInput): void {
  const { ctx, css, view, dpr, doc, measure } = input;
  const S = view.scale;
  ctx.save();
  try {
    clearDevice(ctx);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (input.previewBlur) {
      const r = imageRectToCss(input.previewBlur, view);
      ctx.save();
      ctx.fillStyle = "rgba(245,158,11,0.18)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#F59E0B";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (input.previewStroke) {
      ctx.save();
      ctx.translate(view.tx, view.ty);
      drawStroke(ctx, input.previewStroke, S);
      ctx.restore();
    }

    const selected = doc.strokes.filter((s) => input.selection.has(s.id));
    if (selected.length > 0) {
      const bbox = selectionBBox(selected, measure);
      if (bbox) drawSelection(ctx, bbox, view, input.showHandles, input.pointerDown);
    }

    if (input.hoveredId && !input.selection.has(input.hoveredId)) {
      const hovered = doc.strokes.find((s) => s.id === input.hoveredId);
      if (hovered) {
        const bbox = strokeBBox(hovered, measure);
        const r = imageRectToCss(bbox, view);
        ctx.save();
        ctx.strokeStyle = "rgba(0,242,254,0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    if (input.marquee) {
      const r = imageRectToCss(input.marquee, view);
      ctx.save();
      ctx.fillStyle = "rgba(0,242,254,0.10)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#00F2FE";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (input.keyboardCursor) {
      const p = { x: input.keyboardCursor.x * S + view.tx, y: input.keyboardCursor.y * S + view.ty };
      ctx.save();
      ctx.strokeStyle = FOCUS_RING;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - 9, p.y + 0.5);
      ctx.lineTo(p.x + 9, p.y + 0.5);
      ctx.moveTo(p.x + 0.5, p.y - 9);
      ctx.lineTo(p.x + 0.5, p.y + 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (input.cursor && !input.pointerDown) {
      const { x, y } = input.cursor;
      ctx.save();
      ctx.strokeStyle = "rgba(0,242,254,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, css.h);
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(css.w, y + 0.5);
      ctx.stroke();
      ctx.restore();
    }
  } finally {
    ctx.restore();
  }
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  bbox: Rect,
  view: ViewTransform,
  showHandles: boolean,
  pointerDown: boolean,
): void {
  const r = imageRectToCss(bbox, view);
  ctx.save();
  try {
    ctx.strokeStyle = FOCUS_RING;
    ctx.lineWidth = 1;
    ctx.setLineDash(pointerDown ? [] : [4, 3]);
    ctx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
    ctx.setLineDash([]);
    if (!showHandles) return;
    const half = 4; // constant 8 CSS px (§7.6)
    const pts: Point[] = [
      { x: r.x, y: r.y },
      { x: r.x + r.w / 2, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h / 2 },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x + r.w / 2, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
      { x: r.x, y: r.y + r.h / 2 },
    ];
    for (const p of pts) {
      ctx.fillStyle = "#030712";
      ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
      ctx.strokeStyle = FOCUS_RING;
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x - half + 0.5, p.y - half + 0.5, half * 2 - 1, half * 2 - 1);
    }
  } finally {
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- helpers */

/** Clears the whole backing store regardless of rounding (`css × dpr`). */
function clearDevice(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas;
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
  } finally {
    ctx.restore();
  }
}

function scalePoint(p: Point, S: number): Point {
  return { x: p.x * S, y: p.y * S };
}

function scaleRect(r: Rect, S: number): Rect {
  return { x: r.x * S, y: r.y * S, w: r.w * S, h: r.h * S };
}

export function imageRectToCss(r: Rect, view: ViewTransform): Rect {
  return {
    x: r.x * view.scale + view.tx,
    y: r.y * view.scale + view.ty,
    w: r.w * view.scale,
    h: r.h * view.scale,
  };
}

/** Cached per-`(length|fontSize|wrapWidth)` measure to avoid `measureText` storms. */
const measureCache = new Map<string, MeasureFn>();

export function memoMeasure(measure: MeasureFn, key: string): MeasureFn {
  const cached = measureCache.get(key);
  if (cached) return cached;
  if (measureCache.size >= 128) {
    const oldest = measureCache.keys().next().value;
    if (oldest !== undefined) measureCache.delete(oldest);
  }
  measureCache.set(key, measure);
  return measure;
}

export function clearMeasureCache(): void {
  measureCache.clear();
}

/** A measure function that consults the live context so fonts match exports. */
function measureFor(ctx: CanvasRenderingContext2D): MeasureFn {
  return (text: string, font: string) => {
    ctx.save();
    try {
      ctx.font = font;
      return ctx.measureText(text).width;
    } finally {
      ctx.restore();
    }
  };
}
