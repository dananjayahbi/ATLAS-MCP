/**
 * The single list of persisted event types (mirror of `EventType` in
 * `lib/types/enums.ts`). Kept as a runtime array so the SSE transport can assert
 * that every name it must subscribe to is present.
 */

export const EVENT_TYPES = [
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
] as const;
