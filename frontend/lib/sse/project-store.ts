// Doc 09 §11.4 — Channel A projection: envelope guard, bounded event store, and the
// invalidation-key map. `task.log` is deliberately absent from the map so a log
// frame can never refetch a query (§12 "No refetch on log frames").
import type { TaskEventDTO } from "@/lib/types/api";
import type { EventType, LogLevel } from "@/lib/types/enums";
import { createRingBuffer, PROJECT_MAX_BYTES, PROJECT_MAX_LINES } from "./ring-buffer";
import type { RingBufferSnapshot } from "./ring-buffer";

const LEVELS: readonly LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];

const EVENT_TYPES: readonly EventType[] = [
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.priority_changed",
  "task.dod_updated",
  "task.log",
  "task.lease_expired",
  "task.submitted",
  "review.approved",
  "review.rejected",
  "discovery.created",
  "discovery.approved",
  "discovery.rejected",
  "agent.connected",
  "agent.heartbeat",
  "system.boot",
  "system.recovery",
  "telemetry.tick",
];

/** Type guard for the frozen Doc 01 §7.9 envelope. Control frames are rejected. */
export function isTaskEvent(value: unknown): value is TaskEventDTO {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.seq === "number" &&
    typeof candidate.ts === "string" &&
    typeof candidate.project_slug === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.type === "string" &&
    (EVENT_TYPES as readonly string[]).includes(candidate.type) &&
    typeof candidate.level === "string" &&
    (LEVELS as readonly string[]).includes(candidate.level) &&
    (candidate.task_id === null || typeof candidate.task_id === "string") &&
    (candidate.payload === null ||
      (typeof candidate.payload === "object" && !Array.isArray(candidate.payload)))
  );
}

export type QueryKey = readonly unknown[];

/**
 * Doc 09 §11.4 invalidation map. Every key here is a **prefix** of the keys built
 * by `lib/api/keys.ts` — TanStack matches by prefix, so `["tasks"]` covers
 * `["tasks","board",slug,fk]` and `["tasks","detail",id]`. An empty result means
 * "store only" — never a refetch.
 */
export function invalidationKeys(
  type: TaskEventDTO["type"],
  slug: string,
  taskId: string | null,
): QueryKey[] {
  // These must stay aligned with `qk` in `lib/api/keys.ts`.
  const tasks: QueryKey = ["tasks"];
  const task: QueryKey = taskId ? ["tasks", "detail", taskId] : ["tasks"];
  const telemetry: QueryKey = ["telemetry"];
  const projects: QueryKey = ["projects"];
  const project: QueryKey = ["projects", "detail", slug];
  const matrix: QueryKey = ["telemetry", "matrix"];
  const discoveries: QueryKey = ["discoveries"];
  const reviews: QueryKey = ["reviews"];

  switch (type) {
    case "task.created":
      return [tasks, telemetry, matrix, project, projects];
    // Metadata edits and assignee changes move the card between filter buckets
    // (`agent=`, `q=`) and change project counters, so they must refresh the
    // board, the detail, the rail, the queue and the matrix — not just the row.
    case "task.updated":
      return [tasks, task, telemetry, matrix, project, projects];
    case "task.status_changed":
      return [tasks, task, telemetry, matrix, project, projects];
    case "task.priority_changed":
      return [tasks, task, matrix];
    case "task.dod_updated":
      return [tasks, task];
    case "task.lease_expired":
      return [tasks, task, telemetry];
    case "task.submitted":
      return [tasks, reviews, telemetry];
    case "review.approved":
    case "review.rejected":
      return [tasks, reviews, telemetry, matrix, project];
    case "discovery.created":
      return [discoveries, tasks, telemetry];
    case "discovery.approved":
    case "discovery.rejected":
      return [discoveries, tasks, telemetry];
    case "agent.connected":
      return [projects];
    case "system.boot":
      // Every query — the backend restarted (Doc 09 §13 F6).
      return [[]];
    case "system.recovery":
      return [tasks, task, telemetry, projects];
    case "telemetry.tick":
      return [telemetry];
    case "agent.heartbeat":
      // R2: never routed to Channel A, so this arm is unreachable by contract.
      return [];
    case "task.log":
      // Doc 09 §11.4 / §12 — a log frame must never invalidate or refetch anything.
      return [];
    default:
      return [];
  }
}

export interface EventStoreOptions {
  maxLines?: number;
  maxBytes?: number;
}

export function createEventStore(options: EventStoreOptions = {}) {
  return createRingBuffer<TaskEventDTO>({
    maxLines: options.maxLines ?? PROJECT_MAX_LINES,
    maxBytes: options.maxBytes ?? PROJECT_MAX_BYTES,
    seqOf: (event) => event.seq,
    keyOf: (event) => event.id,
    sizeOf: (event) => event.message.length * 2 + 256,
  });
}

export const EMPTY_EVENTS: readonly TaskEventDTO[] = Object.freeze([]);

export const EMPTY_EVENT_SNAPSHOT: RingBufferSnapshot<TaskEventDTO> = Object.freeze({
  items: EMPTY_EVENTS,
  total: 0,
  dropped: 0,
  duplicates: 0,
  gaps: 0,
  lastSeq: 0,
  version: 0,
});
