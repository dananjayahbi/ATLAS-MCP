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
  frameReason,
  isMockMode,
  projectEventsUrl,
  taskLogUrl,
  withResumeCursor,
} from "./backoff";
export { createEventStream } from "./client";
export type { EventStream, EventStreamOptions } from "./client";

export {
  NAMED_EVENTS,
  SUBSCRIBED_EVENTS,
  TASK_EVENT_NAMES,
  eventSourceTransport,
  frameFromData,
} from "./transport";

export type { Transport, TransportFactory, TransportHandlers } from "./transport";
export { MOCK_FRAME_INTERVAL_MS, createMockTransportFactory, replayFixture } from "./mock-transport";

export { MAX_MESSAGE, clampMessage, sanitiseForExport, sanitiseMessage, sanitiseText } from "./sanitise";
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

export { EMPTY_LINE_SNAPSHOT, EMPTY_LINES, createLineStore, toTaskLogLine } from "./line-store";
export type { LineStore, LineStoreOptions } from "./line-store";
export {
  EMPTY_EVENT_SNAPSHOT,
  EMPTY_EVENTS,
  createEventStore,
  invalidationKeys,
  isTaskEvent,
} from "./project-store";
export type { QueryKey } from "./project-store";

export { useTaskLogStream } from "./hooks/use-task-log-stream";
export { useProjectEvents } from "./hooks/use-project-events";
