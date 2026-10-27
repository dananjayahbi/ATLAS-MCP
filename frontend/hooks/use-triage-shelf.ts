"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DiscoveryDTO } from "@/lib/types/api";

/**
 * Doc 06 §9.5 — optimistic removal plus a **5 s dispatch delay**. The row leaves
 * the list immediately, but no request exists until the timer elapses; `undo`
 * cancels the timer so nothing is ever sent.
 */

export const UNDO_WINDOW_MS = 5000;

export type ShelfEntry = {
  taskId: string;
  kind: "approve" | "reject";
  title: string;
  expiresAt: number;
};

export type TriageShelf = {
  shelf: ShelfEntry[];
  removed: ReadonlySet<string>;
  now: number;
  schedule: (discovery: DiscoveryDTO, kind: "approve" | "reject", priority: number) => void;
  undo: (taskId: string) => void;
};

export type TriageShelfOptions = {
  onApprove: (discovery: DiscoveryDTO, priority: number) => Promise<unknown>;
  onReject: (discovery: DiscoveryDTO) => Promise<unknown>;
  onError: (message: string) => void;
  onDispatched?: (discovery: DiscoveryDTO, kind: "approve" | "reject") => void;
};

export function useTriageShelf({ onApprove, onReject, onError, onDispatched }: TriageShelfOptions): TriageShelf {
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
      map.clear();
    };
  }, []);

  const restore = useCallback((taskId: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
    setShelf((prev) => prev.filter((entry) => entry.taskId !== taskId));
  }, []);

  const schedule = useCallback(
    (discovery: DiscoveryDTO, kind: "approve" | "reject", priority: number) => {
      setRemoved((prev) => new Set(prev).add(discovery.task_id));
      setShelf((prev) => [
        ...prev,
        { taskId: discovery.task_id, kind, title: discovery.title, expiresAt: Date.now() + UNDO_WINDOW_MS },
      ]);

      const timer = window.setTimeout(() => {
        timers.current.delete(discovery.task_id);
        setShelf((prev) => prev.filter((entry) => entry.taskId !== discovery.task_id));
        const run = kind === "approve" ? onApprove(discovery, priority) : onReject(discovery);
        void run
          .then(() => {
            onDispatched?.(discovery, kind);
            restore(discovery.task_id);
          })
          .catch((error: unknown) => {
            onError(error instanceof Error ? error.message : "Triage action failed");
            restore(discovery.task_id);
          });
      }, UNDO_WINDOW_MS);

      timers.current.set(discovery.task_id, timer);
    },
    [onApprove, onDispatched, onError, onReject, restore],
  );

  const undo = useCallback(
    (taskId: string) => {
      const timer = timers.current.get(taskId);
      if (timer) window.clearTimeout(timer);
      timers.current.delete(taskId);
      restore(taskId);
    },
    [restore],
  );

  return { shelf, removed, now, schedule, undo };
}
