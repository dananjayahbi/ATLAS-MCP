// Doc 09 §11.2 — mock transport. Active only when `NEXT_PUBLIC_ATLAS_MOCK === "1"`;
// replays the frozen 60-envelope fixture on a timer so the HUD is fully usable
// offline. Never used in production builds (the flag is inlined at build time).
import type { TaskEventDTO } from "@/lib/types/api";
import { MOCK_EVENTS } from "./mock-data";
import type { Transport, TransportFactory } from "./transport";

/** Cadence of the replay, in ms. Fast enough to feel live, slow enough to read. */
export const MOCK_FRAME_INTERVAL_MS = 350;

export interface MockTransportOptions {
  /** loop back to seq 1 after the last fixture row (default true) */
  readonly loop?: boolean;
  /** only replay events for this task (Channel B semantics) */
  readonly taskId?: string;
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
}

/** Channel B carries `task.log` + that task's `task.status_changed` (Doc 09 §2.1). */
export function matchesChannelB(event: TaskEventDTO, taskId: string | undefined): boolean {
  if (!taskId) return true;
  if (event.task_id !== taskId) return false;
  return event.type === "task.log" || event.type === "task.status_changed";
}

/** Channel A carries everything except `task.log` and `agent.heartbeat` (R1/R2). */
export function matchesChannelA(event: TaskEventDTO): boolean {
  return event.type !== "task.log" && event.type !== "agent.heartbeat";
}

export function createMockTransportFactory(options: MockTransportOptions = {}): TransportFactory {
  const intervalMs = options.intervalMs ?? MOCK_FRAME_INTERVAL_MS;
  const loop = options.loop ?? true;
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number): number => setTimeout(fn, ms) as unknown as number);
  const clearTimer =
    options.clearTimer ??
    ((handle: number): void => {
      clearTimeout(handle);
    });

  return (url, handlers): Transport => {
    // Channel B appends the task id to the path; recover it so the mock honours R3.
    const scopedTaskId =
      options.taskId ?? url.match(/\/stream\/tasks\/([^/?#]+)\/log/)?.[1] ?? undefined;
    const isTaskChannel = scopedTaskId !== undefined;

    const all: readonly TaskEventDTO[] = MOCK_EVENTS;
    const scoped = all.filter((event) =>
      isTaskChannel ? matchesChannelB(event, scopedTaskId) : matchesChannelA(event),
    );
    // The fixture spreads log lines across many task ids, so a strict R3 filter can
    // leave a pane almost empty offline. Fall back to the whole fixture for dev UX.
    const events = scoped.length > 0 ? scoped : all;

    let cursor = 0;
    let closed = false;
    let handle: number | null = null;

    const schedule = (): void => {
      if (closed) return;
      handle = setTimer(tick, intervalMs);
    };

    const tick = (): void => {
      handle = null;
      if (closed) return;
      if (cursor >= events.length) {
        if (!loop) {
          handlers.onError();
          return;
        }
        cursor = 0;
      }
      const event = events[cursor];
      cursor += 1;
      if (!event) return;
      const data = JSON.stringify(event);
      if (event.type === "stream.reset") {
        handlers.onNamedEvent("stream.reset", data, event.id);
      } else {
        handlers.onMessage(data, event.id);
      }
      schedule();
    };

    // Async open keeps mock and real transports observably identical.
    handle = setTimer(() => {
      handle = null;
      if (closed) return;
      handlers.onOpen();
      schedule();
    }, 0);

    return {
      close(): void {
        if (closed) return;
        closed = true;
        if (handle !== null) clearTimer(handle);
        handle = null;
      },
    };
  };
}

/** Synchronous variant for tests: emit every fixture frame immediately. */
export function replayFixture(taskId?: string, channel: "A" | "B" = "B"): readonly TaskEventDTO[] {
  return MOCK_EVENTS.filter((event: TaskEventDTO) =>
    channel === "B" ? matchesChannelB(event, taskId) : matchesChannelA(event),
  );
}
