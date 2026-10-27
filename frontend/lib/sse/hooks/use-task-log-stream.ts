"use client";

// Doc 09 §11.1 — React coupling for Channel B. One buffer + one EventSource per
// task; `useSyncExternalStore` reads the frozen ring snapshot (§12 "Tearing").
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createEventStream, taskLogUrl } from "@/lib/sse/client";
import { downloadLog } from "@/lib/sse/export";
import { frameJson } from "@/lib/sse/frame";
import { EMPTY_LINE_SNAPSHOT, createLineStore, toTaskLogLine } from "@/lib/sse/line-store";
import type { RingBufferSnapshot } from "@/lib/sse/ring-buffer";
import { sanitiseMessage } from "@/lib/sse/sanitise";
import type { StreamState, TaskLogLine, TaskLogStreamHandle, TaskLogStreamOptions } from "@/lib/sse/types";

/** Doc 09 §1.3 — `connected` expires 45 s after the newest frame. */
export const CONNECTED_TTL_MS = 45_000;
const FRESHNESS_POLL_MS = 5_000;

const serverSnapshot = (): RingBufferSnapshot<TaskLogLine> => EMPTY_LINE_SNAPSHOT;

export function useTaskLogStream(taskId: string, options: TaskLogStreamOptions = {}): TaskLogStreamHandle {
  const { maxLines, maxBytes, endpoint, retryFloorMs, retryCeilMs, stallAfterMs, pauseWhenHidden } =
    options;

  // Created once per hook instance; StrictMode double-invocation reuses it (§12).
  const store = useMemo(() => createLineStore({ maxLines, maxBytes }), [maxLines, maxBytes]);

  const [transportState, setTransportState] = useState<StreamState>("connecting");
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [contactAt, setContactAt] = useState(0);
  const [gapCount, setGapCount] = useState(0);
  const [resetReason, setResetReason] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pausedRef = useRef(false);
  const pendingRef = useRef(0);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);

  const setAtBottom = useCallback((atBottom: boolean) => {
    pausedRef.current = !atBottom;
    setPaused(!atBottom);
    if (atBottom) {
      pendingRef.current = 0;
      setNewCount(0);
    }
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    pendingRef.current = 0;
    setPaused(false);
    setNewCount(0);
  }, []);

  const clear = useCallback(() => {
    pendingRef.current = 0;
    setNewCount(0);
    setResetReason(null);
    store.clear();
  }, [store]);

  const exportLog = useCallback(() => {
    downloadLog(taskId, store.getSnapshot().items);
  }, [store, taskId]);

  // A ref-held sink keeps a changing callback identity from tearing down the socket (§12).
  const acceptRef = useRef<(line: TaskLogLine) => void>(() => {});
  acceptRef.current = (line) => {
    if (!store.append(line)) return;
    setContactAt(Date.now());
    setGapCount(store.getSnapshot().gaps);
    if (pausedRef.current) {
      pendingRef.current += 1;
      setNewCount(pendingRef.current);
    }
  };

  useEffect(() => {
    if (!taskId) return;
    // A new task must not inherit the previous task's lines.
    store.clear();
    pendingRef.current = 0;
    setNewCount(0);
    setResetReason(null);
    setGapCount(0);

    const stream = createEventStream(endpoint ?? taskLogUrl(taskId), {
      retryFloorMs,
      retryCeilMs,
      stallAfterMs,
      pauseWhenHidden,
      onFrame(frame) {
        const data = frameJson(frame);
        if (!data) return;
        const line = toTaskLogLine(data, 0);
        if (!line) return;
        // Belt-and-braces: the server sanitised already (§8), the client must not trust it.
        acceptRef.current({ ...line, message: sanitiseMessage(line.message) });
      },
      onReset(reason) {
        // Doc 09 §6.4 — clear the ring, keep the cursor, let REST refill (§6.5).
        setResetReason(reason);
        store.clear();
      },
      onStateChange(state) {
        setTransportState(state);
        // A successful open is itself liveness: comment (`: ping`) frames are not
        // observable through `EventSource`, so `open` re-arms the freshness clock.
        if (state === "open") setContactAt(Date.now());
      },
    });
    return () => stream.close();
  }, [taskId, endpoint, retryFloorMs, retryCeilMs, stallAfterMs, pauseWhenHidden, store]);

  // Freshness clock: only needed while a frame exists, so idle panes stay timer-free.
  useEffect(() => {
    if (!contactAt) return;
    const timer = setInterval(() => setNow(Date.now()), FRESHNESS_POLL_MS);
    return () => clearInterval(timer);
  }, [contactAt]);

  const fresh = contactAt > 0 && now - contactAt < CONNECTED_TTL_MS;
  const connected = transportState === "open" && fresh;

  return useMemo<TaskLogStreamHandle>(
    () => ({
      lines: snapshot.items,
      connected,
      paused,
      newCount,
      clear,
      export: exportLog,
      setAtBottom,
      resume,
      gapCount,
      resetReason,
    }),
    [snapshot, connected, paused, newCount, clear, exportLog, setAtBottom, resume, gapCount, resetReason],
  );
}
