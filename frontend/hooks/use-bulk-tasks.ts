"use client";

import { useCallback, useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { tasksApi } from "@/lib/api/tasks";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api/keys";
import { clampPriority } from "@/lib/format/priority";

/**
 * Doc 06 §8.7 — bulk actions are **sequential with per-row results**, never
 * `Promise.all`: concurrent priority patches on one task race the
 * `BEGIN IMMEDIATE` writer and produce spurious `STALE_LEASE`.
 *
 * Approve-review is deliberately absent — T8 is the only hard human gate and the
 * UI cannot show N patches at once (§8.7 "forbidden").
 */

export type BulkOutcome = { id: string; ok: boolean; message?: string };

export type BulkAction = "setPriority" | "nudge" | "requeue" | "archive";

export type UseBulkTasks = {
  run: (action: BulkAction, ids: readonly string[], value?: number) => Promise<BulkOutcome[]>;
  running: boolean;
  progress: { done: number; total: number };
  lastError: string | null;
};

export function useBulkTasks(): UseBulkTasks {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [lastError, setLastError] = useState<string | null>(null);

  const run = useCallback(
    async (action: BulkAction, ids: readonly string[], value = 0): Promise<BulkOutcome[]> => {
      if (ids.length === 0) return [];
      setRunning(true);
      setProgress({ done: 0, total: ids.length });
      setLastError(null);

      const outcomes: BulkOutcome[] = [];
      for (const id of ids) {
        try {
          if (action === "setPriority") await tasksApi.setPriority(id, clampPriority(value));
          else if (action === "nudge") await tasksApi.setPriority(id, clampPriority(value));
          else if (action === "requeue") await tasksApi.requeue(id);
          else await tasksApi.archive(id);
          outcomes.push({ id, ok: true });
        } catch (error) {
          outcomes.push({ id, ok: false, message: errorMessage(error) });
        }
        setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      }

      const failed = outcomes.filter((row) => !row.ok);
      if (failed.length > 0) {
        setLastError(`${failed.length} of ${ids.length} failed — ${failed[0].message ?? "unknown error"}`);
      }
      setRunning(false);
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.summary() });
      return outcomes;
    },
    [queryClient],
  );

  return { run, running, progress, lastError };
}
