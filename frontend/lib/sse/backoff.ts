// Doc 09 §11.3 — backoff math and the resume-cursor rule, isolated so they are
// unit-testable without constructing an `EventSource`.
import type { SseFrame } from "./types";

/** Append the resume cursor. Our own reconnects have no `Last-Event-ID` header (§6.1). */
export function withResumeCursor(url: string, lastEventId: string | null): string {
  if (!lastEventId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}last_event_id=${encodeURIComponent(lastEventId)}`;
}

/** 3s → 6s → 12s → 24s → 30s (cap), each scaled by 0.8–1.2 (§11.3). */
export function backoffDelay(
  attempt: number,
  floorMs: number,
  ceilMs: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(floorMs * 2 ** Math.max(0, attempt), ceilMs);
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Mock mode is decided at build time by Next's env inlining (§11.2). */
export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_ATLAS_MOCK === "1";
}

/** Reason for a control frame: `payload.reason`, then `error.code`, then the event name. */
export function frameReason(frame: SseFrame | null): string {
  if (!frame) return "UNKNOWN";
  if (!frame.data) return frame.event || "UNKNOWN";
  try {
    const parsed: unknown = JSON.parse(frame.data);
    if (typeof parsed === "object" && parsed !== null) {
      const payload = (parsed as { payload?: unknown }).payload;
      if (typeof payload === "object" && payload !== null) {
        const reason = (payload as { reason?: unknown }).reason;
        if (typeof reason === "string" && reason) return reason;
      }
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === "object" && error !== null) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === "string" && code) return code;
      }
    }
  } catch {
    // Non-JSON control frame: fall through to the event name.
  }
  return frame.event || "UNKNOWN";
}

/** Channel A / B routes (Doc 01 §12). */
export function taskLogUrl(taskId: string): string {
  return `/api/v1/stream/tasks/${encodeURIComponent(taskId)}/log`;
}

export function projectEventsUrl(slug: string): string {
  return `/api/v1/stream/events?project_slug=${encodeURIComponent(slug)}`;
}
