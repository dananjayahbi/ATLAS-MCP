/**
 * Doc 07 §9.3–9.6 — POST the annotation to `/api/v1/assets/`.
 *
 * The client never sends a path (§14.6): the server derives `relative_path`
 * and `absolute_path`. Failures are mapped onto the §14.7 taxonomy and a small
 * retry ladder (250 ms → 750 ms → 1 500 ms) covers transient 5xx/network.
 */
import type { AssetDTO } from "@/lib/types/enums";
import {
  CanvasError,
  canvasErrorFromStatus,
  isRetryableStatus,
} from "./errors";
import { buildMultipartBody, buildUploadFields, EMPTY_SHA256, type RasterisedExport } from "./export";
import type { CanvasDocument, ExportResult } from "./types";

export const ASSET_ENDPOINT = "/api/v1/assets/";
export const RETRY_DELAYS_MS: readonly number[] = [250, 750, 1_500];

export interface UploadOptions {
  taskId: string;
  doc: CanvasDocument;
  raster: RasterisedExport;
  signal?: AbortSignal;
  /** Injected for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function nowIso(): string {
  return new Date().toISOString();
}

/** Greatest number of automatic attempts before the caller queues (§9.5). */
export function maxAttempts(): number {
  return RETRY_DELAYS_MS.length + 1;
}

/**
 * Uploads once, retrying only when the status is retryable. Returns the
 * `ExportResult` Doc 06 consumes via `onExport`.
 */
export async function uploadAnnotation(options: UploadOptions): Promise<ExportResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CanvasError("UPLOAD_NETWORK", "fetch is unavailable");
  }
  const sleep = options.sleep ?? defaultSleep;
  const sha256 = options.raster.sha256 || EMPTY_SHA256;
  const fields = buildUploadFields(options.taskId, options.doc, sha256);
  const form = buildMultipartBody(fields, options.raster.blob);

  let lastError: CanvasError | null = null;
  for (let attempt = 0; attempt < maxAttempts(); attempt += 1) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
    try {
      const response = await fetchImpl(ASSET_ENDPOINT, {
        method: "POST",
        body: form,
        credentials: "same-origin",
        signal: options.signal,
      });
      if (response.ok) {
        const asset = await readAsset(response);
        return {
          asset,
          document: options.doc,
          sha256,
          byte_size: options.raster.byte_size,
          exported_at: nowIso(),
        };
      }
      const body = await readJson(response);
      lastError = canvasErrorFromStatus(response.status, body);
      if (!isRetryableStatus(response.status)) throw lastError;
    } catch (error) {
      if (error instanceof CanvasError && !error.retryable && error.code !== "BACKEND_UNAVAILABLE") {
        throw error;
      }
      if (error instanceof CanvasError) {
        lastError = error;
      } else if (isAbort(error)) {
        throw new CanvasError("UPLOAD_NETWORK", "Upload cancelled", { cause: error });
      } else {
        lastError = new CanvasError("UPLOAD_NETWORK", undefined, { cause: error });
      }
    }
  }
  throw lastError ?? new CanvasError("BACKEND_UNAVAILABLE");
}

async function readAsset(response: Response): Promise<AssetDTO> {
  const body = await readJson(response);
  const candidate = unwrapAsset(body);
  if (!candidate) {
    throw new CanvasError("INTERNAL_ERROR", "Upload succeeded but the response shape was unexpected", {
      status: response.status,
    });
  }
  return candidate;
}

function unwrapAsset(body: unknown): AssetDTO | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const asset = typeof record.asset === "object" && record.asset !== null
    ? (record.asset as Record<string, unknown>)
    : typeof record.id === "string"
      ? record
      : null;
  if (!asset) return null;
  if (typeof asset.id !== "string" || typeof asset.url !== "string") return null;
  return asset as unknown as AssetDTO;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/* --------------------------------------------------------------- pre-upload */

/** §9.4 — 413 must be pre-empted, not discovered after a 25 MB POST. */
export function assertWithinUploadCap(byteSize: number, cap: number): void {
  if (byteSize > cap) {
    throw new CanvasError(
      "EXPORT_TOO_LARGE",
      `Export is ${(byteSize / 1024 / 1024).toFixed(1)} MB; limit ${(cap / 1024 / 1024).toFixed(0)} MB.`,
    );
  }
}
