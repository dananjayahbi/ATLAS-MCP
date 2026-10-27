"use client";

// Doc 09 §11.1 — React coupling for Channel A. Owns the 500-row event ring (Doc 06
// §13.2) and returns the frozen `ProjectEventsState`. `task.log` never invalidates
// a query (§12), and invalidation is coalesced per animation frame (§11.4).
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { QueryClientContext, type QueryClient } from "@tanstack/react-query";
import { createEventStream, projectEventsUrl } from "@/lib/sse/client";
import { frameJson } from "@/lib/sse/frame";
import { EMPTY_EVENT_SNAPSHOT, createEventStore, invalidationKeys, isTaskEvent } from "@/lib/sse/project-store";
import type { RingBufferSnapshot } from "@/lib/sse/ring-buffer";
import type { ProjectEventsOptions, ProjectEventsState } from "@/lib/sse/types";
import type { TaskEventDTO } from "@/lib/types/api";

/** Doc 09 §1.3 — freshness window for `connected`. */
export const CONNECTED_TTL_MS = 45_000;
const FRESHNESS_POLL_MS = 5_000;

const serverSnapshot = (): RingBufferSnapshot<TaskEventDTO> => EMPTY_EVENT_SNAPSHOT;

/** Coalesce a burst into one `invalidateQueries` pass per frame (Doc 09 §11.4). */
function scheduleInvalidation(
  queryClient: QueryClient | null,
  keys: readonly (readonly unknown[])[],
): void {
  if (!queryClient || keys.length === 0) return;
  const run = (): void => {
    for (const key of keys) {
      void queryClient.invalidateQueries({ queryKey: key, stale: true });
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
}

export function useProjectEvents(slug: string, options: ProjectEventsOptions = {}): ProjectEventsState {
  const { maxLines, maxBytes, endpoint, onEvent, invalidate } = options;
  const store = useMemo(() => createEventStore({ maxLines, maxBytes }), [maxLines, maxBytes]);

  // Read the client from context rather than `useQueryClient()`, which throws when
  // the hook is mounted outside a provider (Storybook, unit tests, the mock HUD).
  const queryClient: QueryClient | null = useContext(QueryClientContext) ?? null;

  const [contactAt, setContactAt] = useState(0);
  const [resetReason, setResetReason] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  const clear = useCallback(() => {
    setResetReason(null);
    store.clear();
  }, [store]);

  useEffect(() => {
    if (!slug) return;
    // Switching project must not show another project's events.
    store.clear();
    setResetReason(null);

    const stream = createEventStream(endpoint ?? projectEventsUrl(slug), {
      onFrame(frame) {
        const data = frameJson(frame);
        if (!data || !isTaskEvent(data)) return;

        const event: TaskEventDTO = data;
        // R1 defence-in-depth: Channel A must never carry a log line (Doc 09 §2.3).
        if (event.type === "task.log") return;
        if (!store.append(event)) return;

        setContactAt(Date.now());
        setResetReason(null);
        onEventRef.current?.(event);

        const keys = invalidationKeys(event.type, slug, event.task_id);
        if (keys.length > 0) {
          scheduleInvalidation(queryClient, keys);
          invalidateRef.current?.(keys);
        }
      },
      onReset(reason) {
        // Doc 09 §6.4/§6.5 — degraded mode: refetch everything for this project's scope.
        setResetReason(reason);
        store.clear();
        scheduleInvalidation(queryClient, [
          ["tasks", slug],
          ["discoveries"],
          ["reviews"],
          ["telemetry"],
        ]);
      },
      onStateChange(state) {
        if (state === "open") setContactAt(Date.now());
      },
    });
    return () => stream.close();
  }, [slug, endpoint, store, queryClient]);

  useEffect(() => {
    if (!contactAt) return;
    const timer = setInterval(() => setNow(Date.now()), FRESHNESS_POLL_MS);
    return () => clearInterval(timer);
  }, [contactAt]);

  const connected = contactAt > 0 && now - contactAt < CONNECTED_TTL_MS;

  return useMemo<ProjectEventsState>(
    () => ({
      events: snapshot.items,
      connected,
      lastEventAt: contactAt > 0 ? contactAt : null,
      resetReason,
      clear,
    }),
    [snapshot, connected, contactAt, resetReason, clear],
  );
}
