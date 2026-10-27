import type { ApiErrorBody } from "@/lib/types/api";
import type { ErrorCode } from "@/lib/types/enums";
import { resolveMockRequest } from "./fixtures";

/**
 * Doc 06 §3.1 — typed fetch client with no domain knowledge: URL building, JSON
 * decoding, error-envelope decoding, abort and a bounded GET retry.
 */

export type ApiErrorCode = ErrorCode | "RATE_LIMITED" | "NETWORK_ERROR" | "TIMEOUT" | "ABORTED";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly detail: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    retryable = false,
    detail: Record<string, unknown> = {},
    requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
    this.requestId = requestId;
  }

  static fromEnvelope(body: ApiErrorBody, status: number): ApiError {
    const e = body.error;
    return new ApiError(e.code as ApiErrorCode, status, e.message, e.retryable, e.detail ?? {}, e.request_id);
  }
}

export const API_BASE = "/api/v1";
const TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [250, 750] as const;

export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_ATLAS_MOCK === "1";
}

export type QueryValue = string | number | boolean | null | undefined;

/** Builds `?a=1&b=2`, skipping nullish/empty values so keys stay deterministic. */
export function withQuery(path: string, params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

type RequestOptions = {
  method: Method;
  body?: unknown;
  signal?: AbortSignal;
};

function makeSignal(outer?: AbortSignal): AbortSignal {
  if (typeof AbortSignal.timeout !== "function") return outer ?? new AbortController().signal;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (!outer) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([outer, timeout]);
  return outer;
}

async function decodeError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text) as Partial<ApiErrorBody>;
      if (parsed.error && typeof parsed.error.code === "string") {
        return ApiError.fromEnvelope(parsed as ApiErrorBody, res.status);
      }
    } catch {
      /* fall through to the synthesized error */
    }
  }
  const code: ApiErrorCode =
    res.status === 401 || res.status === 403
      ? "AUTH_INVALID"
      : res.status === 507
        ? "STORAGE_WRITE_FAILED"
        : res.status === 502 || res.status === 503 || res.status === 504
          ? "BACKEND_UNAVAILABLE"
          : "INTERNAL_ERROR";
  return new ApiError(code, res.status, res.statusText || "Request failed", code === "BACKEND_UNAVAILABLE");
}

async function decodeJson<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function shouldRetry(error: unknown, attempt: number, method: Method): boolean {
  if (method !== "GET") return false;
  if (attempt >= RETRY_DELAYS_MS.length) return false;
  if (error instanceof ApiError) {
    return error.code === "BACKEND_UNAVAILABLE" || error.code === "NETWORK_ERROR";
  }
  return true;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attempt<T>(path: string, options: RequestOptions, attemptIndex: number): Promise<T> {
  const url = `${API_BASE}${path}`;
  if (isMockMode()) return resolveMockRequest<T>(url, options.method, options.body);

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: makeSignal(options.signal),
      cache: "no-store",
    });
  } catch (err) {
    if (isAbortError(err) || (err instanceof DOMException && err.name === "TimeoutError")) {
      throw new ApiError("TIMEOUT", 0, "Request timed out", true);
    }
    if (options.signal?.aborted) throw new ApiError("ABORTED", 0, "Request aborted", false);
    const networkError = new ApiError("NETWORK_ERROR", 0, "Orchestration engine unreachable", true);
    if (shouldRetry(networkError, attemptIndex, options.method)) {
      await wait(RETRY_DELAYS_MS[attemptIndex]);
      return attempt<T>(path, options, attemptIndex + 1);
    }
    throw networkError;
  }

  if (!res.ok) {
    const error = await decodeError(res);
    if (shouldRetry(error, attemptIndex, options.method)) {
      await wait(RETRY_DELAYS_MS[attemptIndex]);
      return attempt<T>(path, options, attemptIndex + 1);
    }
    throw error;
  }

  try {
    return await decodeJson<T>(res);
  } catch {
    throw new ApiError("INTERNAL_ERROR", res.status, "Malformed JSON response", false);
  }
}

function request<T>(path: string, options: RequestOptions): Promise<T> {
  return attempt<T>(path, options, 0);
}

export function apiGet<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  return request<T>(path, { method: "GET", signal: init?.signal });
}

export function apiPost<T>(path: string, body?: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  return request<T>(path, { method: "POST", body: body === undefined ? {} : body, signal: init?.signal });
}

export function apiPatch<T>(path: string, body?: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  return request<T>(path, { method: "PATCH", body: body ?? {}, signal: init?.signal });
}

export function apiDelete<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  return request<T>(path, { method: "DELETE", signal: init?.signal });
}

/** Multipart upload — the only call that must not set `Content-Type` itself. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  if (isMockMode()) return resolveMockRequest<T>(`${API_BASE}${path}`, "POST", undefined);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
    signal: makeSignal(),
  });
  if (!res.ok) throw await decodeError(res);
  return decodeJson<T>(res);
}
