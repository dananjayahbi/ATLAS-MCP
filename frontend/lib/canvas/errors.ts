/**
 * Doc 07 §14.7 — the complete canvas error taxonomy.
 *
 * Everything the engine can fail at surfaces as one `CanvasError`. Nothing in
 * this module throws; callers decide whether to `throw` or report through
 * `onError`. Doc 07 §14: "Nothing in the engine throws into React's error
 * boundary."
 */

export type CanvasErrorCode =
  // client-side, image
  | "IMAGE_FETCH_FAILED"
  | "IMAGE_DECODE_FAILED"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_UNSUPPORTED_TYPE"
  // client-side, persistence
  | "CANVAS_AUTOSAVE_FULL"
  | "CANVAS_RESTORE_VERSION"
  // client-side, export
  | "EXPORT_ENCODE_FAILED"
  | "EXPORT_TAINTED"
  | "EXPORT_TOO_LARGE"
  | "EXPORT_HASH_UNAVAILABLE"
  | "EXPORT_FONT_CLAMPED"
  // transport
  | "UPLOAD_NETWORK"
  // server codes (Doc 01 §15)
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "STORAGE_WRITE_FAILED"
  | "PATH_OUT_OF_SCOPE"
  | "TASK_NOT_FOUND"
  | "BACKEND_UNAVAILABLE"
  | "INTERNAL_ERROR";

export const CANVAS_ERROR_MESSAGES: Record<CanvasErrorCode, string> = {
  IMAGE_FETCH_FAILED: "Could not load the screenshot.",
  IMAGE_DECODE_FAILED: "The screenshot file is corrupt.",
  IMAGE_TOO_LARGE: "Image exceeds 40 MP; a proxy will be used.",
  IMAGE_UNSUPPORTED_TYPE: "Unsupported image format.",
  CANVAS_AUTOSAVE_FULL: "Local recovery storage is full; export to save.",
  CANVAS_RESTORE_VERSION: "Recovered draft is from a newer version.",
  EXPORT_ENCODE_FAILED: "Could not encode the PNG.",
  EXPORT_TAINTED: "Image is cross-origin; export blocked.",
  EXPORT_TOO_LARGE: "Export exceeds the 25 MB cap; crop or export at 75 %.",
  EXPORT_HASH_UNAVAILABLE: "Hashing unavailable; dedupe skipped.",
  EXPORT_FONT_CLAMPED: "Some labels were enlarged for legibility.",
  UPLOAD_NETWORK: "Offline — annotation queued.",
  PAYLOAD_TOO_LARGE: "Upload exceeds the 25 MB cap.",
  UNSUPPORTED_MEDIA_TYPE: "Server rejected image/png.",
  STORAGE_WRITE_FAILED: "Disk write failed — retrying.",
  PATH_OUT_OF_SCOPE: "Storage root misconfigured.",
  TASK_NOT_FOUND: "Task no longer exists.",
  BACKEND_UNAVAILABLE: "Backend unavailable — queued.",
  INTERNAL_ERROR: "Unexpected server error.",
};

/**
 * §9.4/§9.5 — whether the *user* can usefully retry. Automatic retry policy
 * lives in `upload.ts`; this flag drives the banner affordance only.
 */
export const CANVAS_ERROR_RETRYABLE: Record<CanvasErrorCode, boolean> = {
  IMAGE_FETCH_FAILED: true,
  IMAGE_DECODE_FAILED: true,
  IMAGE_TOO_LARGE: false,
  IMAGE_UNSUPPORTED_TYPE: false,
  CANVAS_AUTOSAVE_FULL: false,
  CANVAS_RESTORE_VERSION: false,
  EXPORT_ENCODE_FAILED: true,
  EXPORT_TAINTED: false,
  EXPORT_TOO_LARGE: false,
  EXPORT_HASH_UNAVAILABLE: false,
  EXPORT_FONT_CLAMPED: false,
  UPLOAD_NETWORK: true,
  PAYLOAD_TOO_LARGE: false,
  UNSUPPORTED_MEDIA_TYPE: false,
  STORAGE_WRITE_FAILED: true,
  PATH_OUT_OF_SCOPE: false,
  TASK_NOT_FOUND: false,
  BACKEND_UNAVAILABLE: true,
  INTERNAL_ERROR: true,
};

export interface CanvasErrorOptions {
  cause?: unknown;
  /** HTTP status when the error originated from a response. */
  status?: number | null;
  /** Doc 01 §7.8 `error.request_id`, echoed for operator logs. */
  requestId?: string | null;
  detail?: Record<string, unknown> | null;
}

export class CanvasError extends Error {
  readonly code: CanvasErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly detail: Record<string, unknown> | null;
  readonly retryable: boolean;

  constructor(code: CanvasErrorCode, message?: string, options: CanvasErrorOptions = {}) {
    super(message ?? CANVAS_ERROR_MESSAGES[code]);
    this.name = "CanvasError";
    this.code = code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.detail = options.detail ?? null;
    this.retryable = CANVAS_ERROR_RETRYABLE[code];
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function isCanvasError(value: unknown): value is CanvasError {
  return value instanceof CanvasError;
}

export function toCanvasError(
  value: unknown,
  fallback: CanvasErrorCode = "INTERNAL_ERROR",
): CanvasError {
  if (isCanvasError(value)) return value;
  const message = value instanceof Error ? value.message : undefined;
  return new CanvasError(fallback, message, { cause: value });
}

/** Doc 01 §15 — HTTP status → frozen taxonomy. */
export function canvasErrorCodeFromStatus(status: number): CanvasErrorCode {
  switch (status) {
    case 400:
      return "PATH_OUT_OF_SCOPE";
    case 404:
      return "TASK_NOT_FOUND";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 415:
      return "UNSUPPORTED_MEDIA_TYPE";
    case 507:
      return "STORAGE_WRITE_FAILED";
    default:
      return status >= 500 ? "BACKEND_UNAVAILABLE" : "INTERNAL_ERROR";
  }
}

/** Build a `CanvasError` from an HTTP status plus a Doc 01 §7.8 envelope body. */
export function canvasErrorFromStatus(status: number, body?: unknown): CanvasError {
  const fallback = canvasErrorCodeFromStatus(status);
  const envelope = readEnvelope(body);
  const code = (envelope?.code ?? fallback) as CanvasErrorCode;
  const known = Object.prototype.hasOwnProperty.call(CANVAS_ERROR_MESSAGES, code);
  const resolved: CanvasErrorCode = known ? code : fallback;
  return new CanvasError(resolved, envelope?.message, {
    status,
    requestId: envelope?.requestId ?? null,
    detail: envelope?.detail ?? null,
  });
}

interface ErrorEnvelope {
  code: string;
  message?: string;
  requestId: string | null;
  detail: Record<string, unknown> | null;
}

function readEnvelope(body: unknown): ErrorEnvelope | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : null;
  if (!code) return null;
  return {
    code,
    message: typeof record.message === "string" ? record.message : undefined,
    requestId: typeof record.request_id === "string" ? record.request_id : null,
    detail:
      typeof record.detail === "object" && record.detail !== null
        ? (record.detail as Record<string, unknown>)
        : null,
  };
}

/** §9.4 — 408/429 are retried, every other 4xx is terminal. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
