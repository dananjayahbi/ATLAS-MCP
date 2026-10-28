"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiscoveryDTO } from "@/lib/types/api";

/**
 * Doc 06 §9.5 — optimistic removal plus a bounded undo window.
 *
 * The request is dispatched **immediately**; the window only governs how long
 * "Undo" stays available, and undoing issues a real inverse call. The earlier
 * design deferred the request behind a 5 s timer, which meant closing the tab,
 * reloading, or navigating away inside the window silently discarded the action
 * while the row had already vanished — the decision looked saved and was not.
 * A deferred request the operator can outlive is not a persisted decision.
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
  /** Inverse of `onReject`; the server re-admits the row to triage. */
  onRestore: (taskId: string) => Promise<unknown>;
  onError: (message: string) => void;
  onDispatched?: (discovery: DiscoveryDTO, kind: "approve" | "reject") => void;
};

export function useTriageShelf({
  onApprove,
  onReject,
  onRestore,
  onError,
  onDispatched,
}: TriageShelfOptions): TriageShelf {
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef(new Map<string, number>());

  // Kept in a ref so `schedule` stays stable across renders: the callbacks close
  // over mutation objects that are recreated every render, and a changing
  // identity here would let a click schedule against a stale handler.
  const handlers = useRef({ onApprove, onReject, onRestore, onError, onDispatched });
  handlers.current = { onApprove, onReject, onRestore, onError, onDispatched };

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  // Only the countdown timers are cleared on unmount — never a pending request,
  // because no request is ever pending here.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
      map.clear();
    };
  }, []);

  const restoreRow = useCallback((taskId: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
    setShelf((prev) => prev.filter((entry) => entry.taskId !== taskId));
  }, []);

  const schedule = useCallback(
    (discovery: DiscoveryDTO, kind: "approve" | "reject", priority: number) => {
      const taskId = discovery.task_id;

      setRemoved((prev) => new Set(prev).add(taskId));
      setShelf((prev) => [
        // One entry per row: re-clicking must not stack a second undo chip.
        ...prev.filter((entry) => entry.taskId !== taskId),
        { taskId, kind, title: discovery.title, expiresAt: Date.now() + UNDO_WINDOW_MS },
      ]);

      const existing = timers.current.get(taskId);
      if (existing) window.clearTimeout(existing);
      timers.current.set(
        taskId,
        window.setTimeout(() => {
          timers.current.delete(taskId);
          setShelf((prev) => prev.filter((entry) => entry.taskId !== taskId));
        }, UNDO_WINDOW_MS),
      );

      const { onApprove: approve, onReject: reject, onError: fail, onDispatched: done } =
        handlers.current;
      const request = kind === "approve" ? approve(discovery, priority) : reject(discovery);
      void request
        .then(() => {
          // Success: the task left PENDING_APPROVAL, so it stays hidden even if
          // the refetch is slow or fails.
          done?.(discovery, kind);
        })
        .catch((error: unknown) => {
          fail(error instanceof Error ? error.message : "Triage action failed");
          restoreRow(taskId);
        });
    },
    [restoreRow],
  );

  const undo = useCallback(
    (taskId: string) => {
      const entry = shelf.find((row) => row.taskId === taskId);
      const timer = timers.current.get(taskId);
      if (timer) window.clearTimeout(timer);
      timers.current.delete(taskId);
      restoreRow(taskId);

      // Hide-then-send: the row is back in the list immediately and the server
      // catches up. Approve has no inverse route, so it is left as committed.
      if (entry?.kind !== "reject") return;
      void handlers.current.onRestore(taskId).catch((error: unknown) => {
        handlers.current.onError(
          error instanceof Error ? error.message : "Could not restore the discovery",
        );
      });
    },
    [restoreRow, shelf],
  );

  // Memoised so a consumer's effect keyed on the shelf object cannot loop.
  return useMemo(
    () => ({ shelf, removed, now, schedule, undo }),
    [shelf, removed, now, schedule, undo],
  );
}
