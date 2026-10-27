import type { ApiErrorBody } from "@/lib/types/api";
import type { ErrorCode } from "@/lib/types/enums";
import { classifyFetchError, decodeError, decodeJson } from "./decode";
import { resolveMockRequest } from "./fixtures";

/**
 * Doc 06 §3.1 — typed fetch client with no domain knowledge: URL building, JSON
 * decoding, error-envelope decoding, abort, retry. Never sets `Authorization`.
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

  /** 401/403 — the UI pauses queries and shows a sticky toast (Doc 06 §3.6). */
  get isAuth(): boolean {
    return this.code === "AUTH_MISSING" || this.code === "AUTH_INVALID" || this.status === 401 || this.status === 403;
  }

  /** 507 — a rolled-back disk write; surface the degraded banner. */
  get isStorage(): boolean {
    return this.code === "STORAGE_WRITE_FAILED" || this.status === 507;
  }

  /** 409 — the state machine rejected the action; the guard reason must be shown verbatim. */
  get isConflict(): boolean {
    return this.status === 409;
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

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type RequestOptions = { method: Method; body?: unknown; signal?: AbortSignal };

function makeSignal(outer?: AbortSignal): AbortSignal {
  if (typeof AbortSignal.timeout !== "function") return outer ?? new AbortController().signal;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (!outer) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([outer, timeout]);
  return outer;
}

function shouldRetry(error: unknown, attempt: number, method: Method): boolean {
  if (method !== "GET" || attempt >= RETRY_DELAYS_MS.length) return false;
  if (error instanceof ApiError) {
    return error.code === "BACKEND_UNAVAILABLE" || error.code === "NETWORK_ERROR" || error.code === "TIMEOUT";
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
    const error = classifyFetchError(err, options.signal);
    if (error.code === "ABORTED") throw error;
    if (shouldRetry(error, attemptIndex, options.method)) {
      await wait(RETRY_DELAYS_MS[attemptIndex]);
      return attempt<T>(path, options, attemptIndex + 1);
    }
    throw error;
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

const request = <T>(path: string, options: RequestOptions): Promise<T> => attempt<T>(path, options, 0);

export function apiGet<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  return request<T>(path, { method: "GET", signal: init?.signal });
}

/** POST sends `{}` when no body is supplied; review approve accepts an empty JSON body (Doc 01 §8, T8). */
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
