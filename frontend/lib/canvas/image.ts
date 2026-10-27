/**
 * Doc 07 §11.4 / §14.1–14.3 — source image acquisition.
 *
 * `fetch` + `createImageBitmap` (never a bare `<img>`): a misconfigured CORS
 * header surfaces as `IMAGE_FETCH_FAILED` instead of a silent taint that only
 * explodes at export time. The decoded bitmap is a large GPU surface and must
 * be `close()`d by the caller.
 */
import { CanvasError } from "./errors";
import { imagePixelCount, needsProxy, proxySize } from "./viewport";
import type { Size } from "./types";

export interface LoadedImage {
  bitmap: ImageBitmap;
  size: Size;
  /** `true` when the source exceeded 40 MP and was downscaled to a proxy. */
  proxied: boolean;
}

export async function loadBitmap(url: string, signal?: AbortSignal): Promise<LoadedImage> {
  if (!url) throw new CanvasError("IMAGE_FETCH_FAILED", "No source URL supplied");
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", signal });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new CanvasError("IMAGE_FETCH_FAILED", "Could not load the screenshot.", { cause: error });
  }
  if (!response.ok) {
    throw new CanvasError("IMAGE_FETCH_FAILED", `HTTP ${response.status}`, { status: response.status });
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new CanvasError("IMAGE_UNSUPPORTED_TYPE", blob.type || "unknown content type");
  }
  try {
    const bitmap = await decode(blob);
    const natural: Size = { w: bitmap.width, h: bitmap.height };
    if (!needsProxy(natural)) {
      return { bitmap, size: natural, proxied: false };
    }
    bitmap.close();
    const target = proxySize(natural);
    const proxied = await decode(blob, target);
    return { bitmap: proxied, size: { w: proxied.width, h: proxied.height }, proxied: true };
  } catch (error) {
    if (error instanceof CanvasError) throw error;
    throw new CanvasError("IMAGE_DECODE_FAILED", "The screenshot file is corrupt.", { cause: error });
  }
}

async function decode(blob: Blob, resize?: Size): Promise<ImageBitmap> {
  if (resize) {
    return createImageBitmap(blob, {
      imageOrientation: "from-image",
      resizeWidth: resize.w,
      resizeHeight: resize.h,
      resizeQuality: "high",
    });
  }
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** §14.3 — logged but non-fatal; the document records the proxy's size. */
export function proxyWarning(size: Size): CanvasError | null {
  return imagePixelCount(size) > 0 ? new CanvasError("IMAGE_TOO_LARGE") : null;
}

export function disposeBitmap(bitmap: ImageBitmap | null): void {
  if (!bitmap) return;
  try {
    bitmap.close();
  } catch {
    /* already closed */
  }
}
