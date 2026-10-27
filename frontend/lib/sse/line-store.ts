// Doc 09 §12 — the line store lives outside React. A 500-line burst therefore
// cannot render a half-applied array, and `useSyncExternalStore` gets a stable
// snapshot reference between mutations (T2/T11).
import type { LogLevel } from "@/lib/types/enums";
import { createRingBuffer, TASK_LOG_MAX_BYTES, TASK_LOG_MAX_LINES } from "./ring-buffer";
import type { RingBufferSnapshot } from "./ring-buffer";
import type { TaskLogLine } from "./types";

const LEVELS: readonly LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Lenient projection of an SSE `data` JSON object into a `TaskLogLine` (T11). */
export function toTaskLogLine(
  data: Record<string, unknown>,
  fallbackSeq: number,
): TaskLogLine | null {
  const type = data.type;
  // Channel B carries `task.log` + `task.status_changed` only (Doc 09 §2.1/§2.3 R3/R4);
  // `stream.reset` arrives as a named control frame but is tolerated here.
  if (type !== "task.log" && type !== "task.status_changed" && type !== "stream.reset") {
    return null;
  }
  const rawSeq = typeof data.seq === "number" ? data.seq : fallbackSeq;
  const id = typeof data.id === "string" && data.id ? data.id : null;
  const ts = typeof data.ts === "string" && data.ts ? data.ts : new Date().toISOString();
  const level = isLogLevel(data.level) ? data.level : "INFO";
  const message = typeof data.message === "string" ? data.message : "";
  const logType: TaskLogLine["type"] = type;

  return {
    // `stream.reset` carries seq 0 and must never advance the cursor (Doc 09 §6.4).
    seq: logType === "stream.reset" ? 0 : rawSeq,
    id: logType === "stream.reset" ? null : id,
    ts,
    level,
    message,
    type: logType,
    payload: asRecord(data.payload),
  };
}

export interface LineStoreOptions {
  maxLines?: number;
  maxBytes?: number;
}

export interface LineStore {
  append(line: TaskLogLine): boolean;
  clear(): void;
  getSnapshot(): RingBufferSnapshot<TaskLogLine>;
  subscribe(listener: () => void): () => void;
}

export function createLineStore(options: LineStoreOptions = {}): LineStore {
  const buffer = createRingBuffer<TaskLogLine>({
    maxLines: options.maxLines ?? TASK_LOG_MAX_LINES,
    maxBytes: options.maxBytes ?? TASK_LOG_MAX_BYTES,
    seqOf: (line) => line.seq,
    keyOf: (line) => line.id,
    isControl: (line) => line.type === "stream.reset",
    sizeOf: (line) => line.message.length * 2 + 96,
  });

  return {
    append: (line) => buffer.append(line),
    clear: () => buffer.clear(),
    getSnapshot: () => buffer.getSnapshot(),
    subscribe: (listener) => buffer.subscribe(listener),
  };
}

/** Empty snapshot for SSR so the hook and the server agree on the first render. */
export const EMPTY_LINES: readonly TaskLogLine[] = Object.freeze([]);

export const EMPTY_LINE_SNAPSHOT: RingBufferSnapshot<TaskLogLine> = Object.freeze({
  items: EMPTY_LINES,
  total: 0,
  dropped: 0,
  duplicates: 0,
  gaps: 0,
  lastSeq: 0,
  version: 0,
});
