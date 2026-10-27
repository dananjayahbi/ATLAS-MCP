import { toCss } from "./geometry";
import type { MarkupDocument, MarkupPoint, MarkupStroke, MarkupView } from "./types";

/**
 * Two renderers over the same stroke list:
 *
 * - `drawMarkup` paints into CSS space for the on-screen overlay.
 * - `burnMarkup` paints into image-natural space on an offscreen canvas, which
 *   is what gets uploaded as the flattened PNG.
 */

export type DrawInput = {
  ctx: CanvasRenderingContext2D;
  doc: MarkupDocument;
  view: MarkupView;
  /** Live stroke being drawn, in image space. */
  preview?: MarkupStroke | null;
  /** Image-space radius under the eraser cursor, or null when the pen is active. */
  eraserRadius?: number | null;
  eraserAt?: MarkupPoint | null;
  hidden?: ReadonlySet<string>;
};

function strokePath(ctx: CanvasRenderingContext2D, points: MarkupPoint[], width: number, mapper: (p: MarkupPoint) => MarkupPoint) {
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const first = mapper(points[0]);
  if (points.length === 1) {
    // A tap is a dot: stroke a zero-length segment so lineCap draws the circle.
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(first.x + 0.01, first.y);
    ctx.stroke();
    return;
  }
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const point = mapper(points[i]);
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

export function drawMarkup(input: DrawInput): void {
  const { ctx, doc, view, preview, hidden } = input;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();

  const css = (p: MarkupPoint) => toCss(p, view);
  for (const stroke of doc.strokes) {
    if (hidden?.has(stroke.id)) continue;
    ctx.strokeStyle = stroke.color;
    // Width stays in image units so zooming thickens the ink with the image.
    strokePath(ctx, stroke.points, stroke.width * view.scale, css);
  }

  if (preview) {
    ctx.strokeStyle = preview.color;
    ctx.globalAlpha = 0.9;
    strokePath(ctx, preview.points, preview.width * view.scale, css);
    ctx.globalAlpha = 1;
  }

  if (input.eraserRadius && input.eraserAt) {
    const centre = toCss(input.eraserAt, view);
    const radius = input.eraserRadius * view.scale;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, Math.max(3, radius), 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.restore();
}

/**
 * Flatten onto a copy of the source image at natural resolution.
 *
 * The markup overlay only ever shows strokes over an `<img>`; the burn-in must
 * reproduce the *original* bitmap underneath, otherwise saving a crop or a
 * zoomed view would silently degrade the evidence.
 */
export async function burnMarkup(
  image: CanvasImageSource,
  doc: MarkupDocument,
  options: { type?: string; quality?: number } = {},
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("burnMarkup requires a DOM canvas");
  }
  const canvas = document.createElement("canvas");
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");

  ctx.drawImage(image, 0, 0, doc.width, doc.height);
  const identity = (p: MarkupPoint) => p;
  for (const stroke of doc.strokes) {
    ctx.strokeStyle = stroke.color;
    strokePath(ctx, stroke.points, stroke.width, identity);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas encoding failed"))),
      options.type ?? "image/png",
      options.quality,
    );
  });
}
