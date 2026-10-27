// Doc 09 §1.3 — public shape. Frozen for Doc 06; additive members live on the
// handle types below so the published interfaces never change.
import type { TaskEventDTO } from "@/lib/types/api";
import type { LogLevel } from "@/lib/types/enums";

/** Transport pseudo-types (§6.4). `stream.reset` is never a persisted TaskEvent. */
export type TaskLogType = "task.log" | "task.status_changed" | "stream.reset";

/** Doc 09 §11.2 — the four observable transport states. */
export type StreamState = "connecting" | "open" | "retrying" | "closed";

export interface TaskLogLine {
  /** monotonic per project; the dedupe + sort key */
  readonly seq: number;
  /** evt_<ULID>; null only on control frames */
  readonly id: string | null;
  /** ISO-8601 Z, ms precision */
  readonly ts: string;
  readonly level: LogLevel;
  /** sanitised, <= 4000 chars, may contain \n */
  readonly message: string;
  readonly type: TaskLogType;
  readonly payload: Record<string, unknown>;
}

export interface TaskLogStreamState {
  lines: readonly TaskLogLine[];
  /** EventSource open && last frame < 45 s ago */
  connected: boolean;
  /** user scrolled away from bottom */
  paused: boolean;
  /** lines arrived while paused */
  newCount: number;
  clear(): void;
  /** downloads `${taskId}-execution.log` */
  export(): void;
}

/** Additive control surface; never required by the frozen contract. */
export interface TaskLogStreamControls {
  /** report the pane's scroll position; `false` pauses autoscroll accounting */
  setAtBottom(atBottom: boolean): void;
  /** resume autoscroll and zero `newCount` */
  resume(): void;
}

export interface TaskLogStreamHandle extends TaskLogStreamState, TaskLogStreamControls {
  /** number of detected `seq` discontinuities (Doc 09 §9 / F9) */
  gapCount: number;
  /** last `stream.reset` reason, null once a later frame arrives */
  resetReason: string | null;
}

export interface TaskLogStreamOptions {
  /** ring buffer ceiling; default 2000 (Doc 09 §15) */
  maxLines?: number;
  /** ring buffer byte ceiling; default 2 MB (Doc 09 §15) */
  maxBytes?: number;
  /** override the Channel B route (tests / storybook) */
  endpoint?: string;
  retryFloorMs?: number;
  retryCeilMs?: number;
  stallAfterMs?: number;
  /** stop stall detection and release the socket while the tab is hidden */
  pauseWhenHidden?: boolean;
}

export interface ProjectEventsState {
  /** Channel A ring, oldest -> newest, `seq` ascending (Doc 06 §13.2) */
  readonly events: readonly TaskEventDTO[];
  /** EventSource open && last frame < 45 s ago */
  readonly connected: boolean;
  /** epoch ms of the newest frame, or null before the first frame */
  readonly lastEventAt: number | null;
  /** last `stream.reset` reason, cleared when the stream reopens */
  readonly resetReason: string | null;
  clear(): void;
}

export interface ProjectEventsOptions {
  /** ring ceiling; default 500 (Doc 09 §15) */
  maxLines?: number;
  /** byte ceiling; default 512 kB (Doc 09 §15) */
  maxBytes?: number;
  endpoint?: string;
  /** fired per accepted frame, after the ring buffer mutates */
  onEvent?: (event: TaskEventDTO) => void;
  /** receives the Doc 09 §11.4 key groups for the event type */
  invalidate?: (keys: readonly (readonly unknown[])[]) => void;
}

/** One decoded SSE block. Comment-only blocks yield `event: ""`. */
export interface SseFrame {
  readonly id: string | null;
  readonly event: string;
  readonly data: string;
  readonly retry: number | null;
  readonly comment: string | null;
  readonly receivedAt: number;
}
