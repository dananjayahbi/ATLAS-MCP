// Doc 09 §11.2 / §11.3 — SSE lifecycle manager. Owns exactly one socket at a time,
// exponential backoff with ±20 % jitter (3s→30s cap), `Last-Event-ID` resume,
// 45 s stall detection, and visibility suspension. React-free.
import { backoffDelay, frameReason, isMockMode, withResumeCursor } from "./backoff";
import { frameFromData } from "./transport";
import { createMockTransportFactory } from "./mock-transport";
import { eventSourceTransport, type Transport, type TransportHandlers } from "./transport";
import type { SseFrame, StreamState } from "./types";

export interface EventStreamOptions {
  onFrame(frame: SseFrame): void;
  onReset(reason: string): void;
  onStateChange(state: StreamState): void;
  /** default 3000 (Doc 09 §11.3) */
  retryFloorMs?: number;
  /** default 30000 (Doc 09 §11.3) */
  retryCeilMs?: number;
  /** default 45000 (Doc 09 §9 "client stall threshold") */
  stallAfterMs?: number;
  /** release the socket while the document is hidden (Doc 09 §9) */
  pauseWhenHidden?: boolean;
  /** injectable timers for unit tests */
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
  random?: () => number;
}

export interface EventStream {
  /** permanent teardown; idempotent */
  close(): void;
  /** release the socket without forgetting the cursor (tab hidden) */
  suspend(): void;
  /** reopen after `suspend()` */
  resume(): void;
  /** force a reconnect now, preserving the cursor (F1 "Retry now") */
  reconnectNow(): void;
  readonly lastEventId: string | null;
  readonly state: StreamState;
}

const defaultSetTimer = (fn: () => void, ms: number): number =>
  setTimeout(fn, ms) as unknown as number;
const defaultClearTimer = (handle: number): void => {
  clearTimeout(handle);
};

export {
  backoffDelay,
  frameReason,
  isMockMode,
  projectEventsUrl,
  taskLogUrl,
  withResumeCursor,
} from "./backoff";
/**
 * Create one SSE connection for `url`. Only a single transport is alive at any
 * instant; every path that replaces it goes through `detach()` first.
 */
export function createEventStream(url: string, options: EventStreamOptions): EventStream {
  const floor = options.retryFloorMs ?? 3000;
  const ceil = options.retryCeilMs ?? 30000;
  const stallAfter = options.stallAfterMs ?? 45000;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const clearTimer = options.clearTimer ?? defaultClearTimer;
  const random = options.random ?? Math.random;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const transportFactory = isMockMode() ? createMockTransportFactory() : eventSourceTransport;

  let transport: Transport | null = null;
  let lastEventId: string | null = null;
  let state: StreamState = "connecting";
  let attempt = 0;
  let retryTimer: number | null = null;
  let stallTimer: number | null = null;
  let closed = false;
  let suspended = false;

  const clearRetry = (): void => {
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
  };

  const clearStall = (): void => {
    if (stallTimer !== null) clearTimer(stallTimer);
    stallTimer = null;
  };

  const detach = (): void => {
    transport?.close();
    transport = null;
  };

  const emitState = (next: StreamState): void => {
    if (state === next) return;
    state = next;
    options.onStateChange(next);
  };

  const armStall = (): void => {
    clearStall();
    if (closed || suspended) return;
    stallTimer = setTimer(() => {
      stallTimer = null;
      // 45 s without any frame (pings included) means the socket is wedged (§13 F4).
      scheduleReconnect();
    }, stallAfter);
  };

  function scheduleReconnect(): void {
    if (closed || suspended) return;
    detach();
    clearStall();
    clearRetry();
    emitState("retrying");
    const delay = backoffDelay(attempt, floor, ceil, random);
    attempt += 1;
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (!closed && !suspended) connect();
    }, delay);
  }

  function connect(): void {
    if (closed || suspended) return;
    emitState(attempt > 0 ? "retrying" : "connecting");

    const handleControl = (name: string, data: string, id: string): void => {
      armStall();
      const frame: SseFrame = frameFromData(data, name, id);

      // Doc 09 §5.3: only `error`, `stream.reset` and `stream.reconnect` are
      // control frames. Every task event is ALSO a named event (`event: task.log`),
      // so an unrecognised name must be delivered as a normal frame. Treating it
      // as `stream.reconnect` makes the client redial on every single event.
      if (name === "error" || name === "stream.reset") {
        if (id) lastEventId = id;
        options.onReset(frameReason(frame) || name);
        return;
      }
      if (name === "stream.reconnect") {
        if (id) lastEventId = id;
        scheduleReconnect();
        return;
      }

      if (id) lastEventId = id;
      options.onFrame(frame);
    };

    transport = transportFactory(withResumeCursor(url, lastEventId), {
      onOpen() {
        if (closed) return;
        attempt = 0;
        emitState("open");
        armStall();
      },
      onMessage(data, id) {
        if (closed) return;
        armStall();
        if (id) lastEventId = id;
        options.onFrame(frameFromData(data, "", id));
      },
      onNamedEvent(name, data, id) {
        if (!closed) handleControl(name, data, id);
      },
      onError() {
        if (closed) return;
        emitState("retrying");
        scheduleReconnect();
      },
    } satisfies TransportHandlers);
  }

  function suspend(): void {
    if (closed || suspended) return;
    suspended = true;
    clearRetry();
    clearStall();
    detach();
    emitState("retrying");
  }

  function resume(): void {
    if (closed || !suspended) return;
    suspended = false;
    attempt = 0;
    connect();
  }

  const onVisibility = (): void => {
    if (closed) return;
    if (document.visibilityState === "hidden") suspend();
    else resume();
  };

  if (pauseWhenHidden && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  connect();

  return {
    close(): void {
      if (closed) return;
      closed = true;
      clearRetry();
      clearStall();
      detach();
      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      emitState("closed");
    },
    suspend,
    resume,
    reconnectNow(): void {
      if (closed) return;
      suspended = false;
      attempt = 0;
      scheduleReconnect();
    },
    get lastEventId(): string | null {
      return lastEventId;
    },
    get state(): StreamState {
      return state;
    },
  };
}

