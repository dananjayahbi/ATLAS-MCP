/**
 * Doc 07 §5.3 / §6.4 / §7.3 — DPR-aware sizing, fit-to-container scale,
 * zoom clamps and pan bounds. Framework-free: no React imports.
 */
import type { Size, ViewTransform } from "./types";

/** §5.3 — beyond 2× the memory cost buys no legibility. */
export const MAX_DPR = 2;
/** 24 CSS px margin per side, so the image never touches the frame. */
export const FIT_MARGIN = 24;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;
export const MAX_ABSOLUTE_SCALE = 8;
export const MIN_VISIBLE_FRACTION = 0.15;

export function resolveDpr(): number {
  if (typeof window === "undefined") return 1;
  const raw = window.devicePixelRatio;
  return Math.min(Number.isFinite(raw) && raw > 0 ? raw : 1, MAX_DPR);
}

export interface BackingStore {
  cssW: number;
  cssH: number;
  dpr: number;
  deviceW: number;
  deviceH: number;
}

/** §5.3 normative formula — all three layers must use this exact result. */
export function computeBackingStore(cssW: number, cssH: number, dpr = resolveDpr()): BackingStore {
  const safeW = Math.max(0, Math.floor(cssW));
  const safeH = Math.max(0, Math.floor(cssH));
  return {
    cssW: safeW,
    cssH: safeH,
    dpr,
    deviceW: Math.round(safeW * dpr),
    deviceH: Math.round(safeH * dpr),
  };
}

/**
 * Applies the backing store to a canvas and returns a context whose units are
 * CSS px. `null` when the 2D context is unavailable (never throws).
 */
export function applyDpr(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  dpr = resolveDpr(),
): CanvasRenderingContext2D | null {
  const store = computeBackingStore(cssW, cssH, dpr);
  if (canvas.width !== store.deviceW) canvas.width = store.deviceW;
  if (canvas.height !== store.deviceH) canvas.height = store.deviceH;
  canvas.style.width = `${store.cssW}px`;
  canvas.style.height = `${store.cssH}px`;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;
  ctx.setTransform(store.dpr, 0, 0, store.dpr, 0, 0);
  return ctx;
}

/** §5.3 — fit with a 24 CSS px margin on every side. */
export function fitScale(container: Size, image: Size): number {
  if (image.w <= 0 || image.h <= 0) return 1;
  const availW = Math.max(container.w - FIT_MARGIN * 2, 1);
  const availH = Math.max(container.h - FIT_MARGIN * 2, 1);
  const scale = Math.min(availW / image.w, availH / image.h);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function scaleBounds(fit: number): { min: number; max: number } {
  const min = Math.min(fit * MIN_ZOOM, MAX_ABSOLUTE_SCALE);
  const max = Math.min(fit * MAX_ZOOM, MAX_ABSOLUTE_SCALE);
  return { min, max: Math.max(min, max) };
}

export function clampScale(scale: number, fit: number): number {
  const { min, max } = scaleBounds(fit);
  return Math.min(Math.max(scale, min), max);
}

/** View that centres the image inside the container at `fitScale`. */
export function fitView(container: Size, image: Size): ViewTransform {
  const scale = fitScale(container, image);
  return {
    scale,
    tx: (container.w - image.w * scale) / 2,
    ty: (container.h - image.h * scale) / 2,
  };
}

/** §7.3 — keep at least 15 % of the image visible on each axis. */
export function clampPan(
  view: ViewTransform,
  container: Size,
  image: Size,
): ViewTransform {
  const drawnW = image.w * view.scale;
  const drawnH = image.h * view.scale;
  const keepX = Math.min(drawnW * MIN_VISIBLE_FRACTION, container.w);
  const keepY = Math.min(drawnH * MIN_VISIBLE_FRACTION, container.h);
  const minTx = keepX - drawnW;
  const maxTx = container.w - keepX;
  const minTy = keepY - drawnH;
  const maxTy = container.h - keepY;
  return {
    scale: view.scale,
    tx: Math.min(Math.max(view.tx, minTx), maxTx),
    ty: Math.min(Math.max(view.ty, minTy), maxTy),
  };
}

/** Zoom about a css anchor so the image point under it stays put (§7.3). */
export function zoomAtPoint(
  view: ViewTransform,
  anchorCss: { x: number; y: number },
  nextScale: number,
  fit: number,
  container: Size,
  image: Size,
): ViewTransform {
  const scale = clampScale(nextScale, fit);
  const ratio = scale / view.scale;
  const tx = anchorCss.x - (anchorCss.x - view.tx) * ratio;
  const ty = anchorCss.y - (anchorCss.y - view.ty) * ratio;
  return clampPan({ scale, tx, ty }, container, image);
}

/** §7.3 — `newScale = clamp(scale * exp(-deltaY * 0.0015))`. */
export function wheelZoomScale(current: number, deltaY: number, fit: number): number {
  return clampScale(current * Math.exp(-deltaY * 0.0015), fit);
}

export function panBy(view: ViewTransform, dx: number, dy: number, container: Size, image: Size): ViewTransform {
  return clampPan({ scale: view.scale, tx: view.tx + dx, ty: view.ty + dy }, container, image);
}

/**
 * §6.4 — transform for drawing a CSS-px-space surface. The renderer works in
 * CSS px and scales stroke widths explicitly (§6.4 decision), so base/ink/
 * overlay only ever get the DPR transform from `applyDpr`.
 */
export function applyView(
  ctx: CanvasRenderingContext2D,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function clearSurface(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  void cssW;
  void cssH;
}

/** §14.3 — refuse above 40 MP and offer a 4096 proxy instead. */
export const MAX_IMAGE_PIXELS = 40_000_000;
export const PROXY_MAX_DIM = 4096;

export function imagePixelCount(image: Size): number {
  return Math.max(0, image.w) * Math.max(0, image.h);
}

export function needsProxy(image: Size): boolean {
  return imagePixelCount(image) > MAX_IMAGE_PIXELS;
}

/** Proxy dimensions preserving aspect ratio, capped at 4096 on the long edge. */
export function proxySize(image: Size): Size {
  const longest = Math.max(image.w, image.h);
  if (longest <= PROXY_MAX_DIM) return image;
  const k = PROXY_MAX_DIM / longest;
  return { w: Math.max(1, Math.round(image.w * k)), h: Math.max(1, Math.round(image.h * k)) };
}
