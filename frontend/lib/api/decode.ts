import type { ApiErrorBody } from "@/lib/types/api";
import { ApiError, type ApiErrorCode } from "./client";

/** Doc 06 §3.1 — response decoding, split out so `client.ts` stays transport-only. */

export async function decodeError(res: Response): Promise<ApiError> {
  const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text) as Partial<ApiErrorBody>;
      if (parsed.error && typeof parsed.error.code === "string") {
        return ApiError.fromEnvelope(parsed as ApiErrorBody, res.status, retryAfterMs);
      }
    } catch {
      /* fall through to the synthesized error */
    }
  }
  const code: ApiErrorCode =
    res.status === 401 || res.status === 403
      ? "AUTH_INVALID"
      : res.status === 429
        ? "RATE_LIMITED"
        : res.status === 507
          ? "STORAGE_WRITE_FAILED"
          : res.status === 502 || res.status === 503 || res.status === 504
            ? "BACKEND_UNAVAILABLE"
            : "INTERNAL_ERROR";
  return new ApiError(
    code,
    res.status,
    res.statusText || "Request failed",
    code === "BACKEND_UNAVAILABLE" || code === "RATE_LIMITED",
    {},
    null,
    retryAfterMs,
  );
}

/**
 * `Retry-After` is delta-seconds on a 429 (Doc 04 §3.4) but HTTP also permits an
 * HTTP-date, so both are accepted. Returns `null` when absent or unparseable.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

export async function decodeJson<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Abort/network/timeout classification shared by the retry and toast layers. */
export function classifyFetchError(err: unknown, signal?: AbortSignal): ApiError {
  if (signal?.aborted) return new ApiError("ABORTED", 0, "Request aborted", false);
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return new ApiError("TIMEOUT", 0, "Request timed out", true);
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return new ApiError("ABORTED", 0, "Request aborted", false);
  }
  return new ApiError("NETWORK_ERROR", 0, "Orchestration engine unreachable", true);
}
