import { ApiError, type ApiErrorCode } from "./client";

/** Doc 06 §3.6 — `ApiError` → toast spec. Pure so the mapping is unit-testable. */

export type ToastLevel = "info" | "warn" | "error";

export type ToastSpec = {
  level: ToastLevel;
  title: string;
  body?: string;
  sticky: boolean;
  /** Should the caller invalidate parent lists after showing this? */
  invalidate: boolean;
};

function str(detail: Record<string, unknown>, key: string): string | undefined {
  const value = detail[key];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

export function toToast(error: unknown): ToastSpec {
  if (!(error instanceof ApiError)) {
    return { level: "error", title: "Unexpected error", body: "See the browser console for detail.", sticky: false, invalidate: false };
  }
  const { code, detail, requestId, message } = error;
  const spec: Record<ApiErrorCode, () => ToastSpec> = {
    VALIDATION_ERROR: () => ({
      level: "warn",
      title: `Invalid field${str(detail, "field") ? `: ${str(detail, "field")}` : ""}`,
      body: message,
      sticky: false,
      invalidate: false,
    }),
    PATH_OUT_OF_SCOPE: () => ({ level: "error", title: "Path rejected: outside storage root", sticky: false, invalidate: false }),
    AUTH_MISSING: () => ({ level: "error", title: "Session token rejected", body: "Restart the dev proxy.", sticky: true, invalidate: false }),
    AUTH_INVALID: () => ({ level: "error", title: "Session token rejected", body: "Restart the dev proxy.", sticky: true, invalidate: false }),
    PROJECT_NOT_FOUND: () => ({ level: "warn", title: "Project no longer exists", sticky: false, invalidate: true }),
    TASK_NOT_FOUND: () => ({ level: "warn", title: "Task no longer exists", sticky: false, invalidate: true }),
    ASSET_NOT_FOUND: () => ({ level: "warn", title: "Asset no longer exists", sticky: false, invalidate: true }),
    INVALID_TRANSITION: () => ({
      level: "warn",
      title: `Cannot ${str(detail, "action") ?? "apply"} from ${str(detail, "from") ?? "this state"} — refreshing`,
      body: message,
      sticky: false,
      invalidate: true,
    }),
    TASK_ALREADY_LEASED: () => ({
      level: "warn",
      title: `Leased by ${str(detail, "assigned_agent_id") ?? "another agent"}`,
      body: "Force release returns the task to PENDING.",
      sticky: false,
      invalidate: false,
    }),
    STALE_LEASE: () => ({ level: "info", title: "Lease expired — refreshing", sticky: false, invalidate: true }),
    DEPENDENCY_CYCLE: () => ({ level: "error", title: "Dependency cycle rejected", sticky: false, invalidate: false }),
    DEPENDENCY_UNSATISFIABLE: () => ({ level: "warn", title: "Blocker is REJECTED; task is unclaimable", sticky: false, invalidate: true }),
    PAYLOAD_TOO_LARGE: () => ({ level: "error", title: "Patch exceeds 5 MB", sticky: false, invalidate: false }),
    UNSUPPORTED_MEDIA_TYPE: () => ({ level: "error", title: "Only PNG/JPEG/WebP/MD/TXT allowed", sticky: false, invalidate: false }),
    RATE_LIMITED: () => ({ level: "info", title: "Throttled — retrying", sticky: false, invalidate: false }),
    INTERNAL_ERROR: () => ({
      level: "error",
      title: `Internal error${requestId ? ` · ${requestId}` : ""}`,
      body: message,
      sticky: false,
      invalidate: false,
    }),
    STORAGE_WRITE_FAILED: () => ({ level: "error", title: "Disk write failed — state rolled back", sticky: true, invalidate: true }),
    BACKEND_UNAVAILABLE: () => ({ level: "error", title: "Orchestration engine unreachable", sticky: true, invalidate: false }),
    NETWORK_ERROR: () => ({ level: "error", title: "Orchestration engine unreachable", sticky: true, invalidate: false }),
    TIMEOUT: () => ({ level: "warn", title: "Request timed out", sticky: false, invalidate: false }),
    ABORTED: () => ({ level: "info", title: "Request cancelled", sticky: false, invalidate: false }),
  };
  const builder = spec[code] ?? spec.INTERNAL_ERROR;
  return builder();
}

/** Human copy for a failed mutation, used by inline error rows. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}
