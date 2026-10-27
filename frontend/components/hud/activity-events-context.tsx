"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_EVENTS } from "@/lib/sse";
import type { TaskEventDTO } from "@/lib/types/api";

/**
 * Doc 06 §13.2 — a read-only view of the Channel A ring that `AppShell` owns.
 *
 * The ring must be shared rather than re-subscribed: a second `useProjectEvents`
 * would open a second `EventSource`, double the fan-out cost and make the two
 * copies disagree on `seq`. The shell provides; any number of views consume.
 */

const ActivityContext = createContext<readonly TaskEventDTO[]>(EMPTY_EVENTS);

export function ActivityEventsProvider({
  events,
  children,
}: {
  events: readonly TaskEventDTO[];
  children: ReactNode;
}) {
  return <ActivityContext.Provider value={events}>{children}</ActivityContext.Provider>;
}

export function useActivityEvents(): readonly TaskEventDTO[] {
  return useContext(ActivityContext);
}
