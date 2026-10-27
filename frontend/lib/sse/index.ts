// Doc 09 §1.3 — the published surface. Doc 06 imports only from this barrel
// (`@/lib/sse`) or the two hook paths it lists explicitly.
export type {
  ProjectEventsOptions,
  ProjectEventsState,
  SseFrame,
  StreamState,
  TaskLogLine,
  TaskLogStreamControls,
  TaskLogStreamHandle,
  TaskLogStreamOptions,
  TaskLogStreamState,
  TaskLogType,
} from "./types";

export {
  DEFAULT_RETRY_MS,
  flushSseBuffer,
  frameJson,
  hasPartialFrame,
  parseFullFrame,
  parseSseChunk,
} from "./frame";

export {
  PROJECT_MAX_BYTES,
  PROJECT_MAX_LINES,
  TASK_LOG_MAX_BYTES,
  TASK_LOG_MAX_LINES,
  createRingBuffer,
} from "./ring-buffer";
export type { RingBuffer, RingBufferOptions, RingBufferSnapshot } from "./ring-buffer";

export {
  backoffDelay,
  createEventStream,
  frameReason,
  isMockMode,
  projectEventsUrl,
  taskLogUrl,
  withResumeCursor,
} from "./client";
export type { EventStream, EventStreamOptions } from "./client";

export { eventSourceTransport, NAMED_EVENTS } from "./transport";
export { MOCK_FRAME_INTERVAL_MS, createMockTransportFactory, replayFixture } from "./mock-transport";

export { MAX_MESSAGE, clampMessage, sanitiseMessage, sanitiseText } from "./sanitise";
export {
  buildLogBlob,
  buildLogText,
  copyLog,
  downloadLog,
  exportFileName,
  formatIso,
  formatTime,
  toLogText,
} from "./export";

export { createLineStore, toTaskLogLine } from "./line-store";
export type { LineStore, LineStoreOptions } from "./line-store";
export { createEventStore, invalidationKeys, isTaskEvent } from "./project-store";
export type { QueryKey } from "./project-store";

export { useTaskLogStream } from "./hooks/use-task-log-stream";
export { useProjectEvents } from "./hooks/use-project-events";
