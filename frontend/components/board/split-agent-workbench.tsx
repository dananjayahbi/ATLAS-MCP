"use client";

import { useQueries } from "@tanstack/react-query";
import { cn } from "@/lib/format/cn";
import { tasksApi } from "@/lib/api/tasks";
import { qk } from "@/lib/api/keys";
import { useForceRelease } from "@/lib/api/queries";
import type { TaskDetailDTO } from "@/lib/types/api";
import { toast } from "@/hooks/use-toast";
import { AgentPane } from "./agent-pane";
import { SplitWorkspace } from "./split-workspace";
import { useShellStore, type SplitLayout } from "@/hooks/use-shell-store";

/**
 * Doc 06 §7 — one `useTask` per assigned slot (never a subscription at shell level,
 * §15.4), so a streaming log re-renders only its own pane.
 */

export type SplitAgentWorkbenchProps = {
  layout: SplitLayout;
  onLayoutChange: (layout: SplitLayout) => void;
  projects: string[];
  tasks: (string | null)[];
  onOpenTask?: (projectSlug: string, taskId: string) => void;
  onClearSlot?: (slot: number) => void;
  className?: string;
};

export function SplitAgentWorkbench({
  layout,
  onLayoutChange,
  projects,
  tasks,
  onOpenTask,
  onClearSlot,
  className,
}: SplitAgentWorkbenchProps) {
  const focusedSlot = useShellStore((state) => state.focusedSlot);
  const focusSlot = useShellStore((state) => state.focusSlot);
  const forceRelease = useForceRelease();

  const slots = tasks
    .map((taskId, slot) => ({ slot, taskId, projectSlug: projects[slot] ?? null }))
    .filter((entry) => entry.taskId !== null && entry.projectSlug !== null);

  const detailQueries = useQueries({
    queries: slots.map((entry) => ({
      queryKey: qk.tasks.detail(entry.taskId ?? ""),
      queryFn: ({ signal }: { signal: AbortSignal }) => tasksApi.get(entry.taskId ?? "", signal),
      staleTime: 5_000,
      refetchInterval: 20_000,
      enabled: Boolean(entry.taskId),
    })),
  });

  const detailBySlot = new Map<number, TaskDetailDTO | undefined>();
  slots.forEach((entry, index) => {
    detailBySlot.set(entry.slot, detailQueries[index]?.data as TaskDetailDTO | undefined);
  });

  return (
    <SplitWorkspace
      layout={layout}
      onLayoutChange={onLayoutChange}
      occupiedSlots={slots.map((entry) => entry.slot)}
      className={className}
      renderCell={(slot, occupied) => (
        <AgentPane
          slot={slot}
          projectSlug={projects[slot] ?? null}
          task={detailBySlot.get(slot) ?? null}
          loading={occupied && detailBySlot.get(slot) === undefined}
          focused={slot === focusedSlot}
          onFocus={() => focusSlot(slot)}
          onOpenTask={() => {
            const entry = slots.find((item) => item.slot === slot);
            if (entry?.taskId && entry.projectSlug) onOpenTask?.(entry.projectSlug, entry.taskId);
          }}
          onClear={onClearSlot ? () => onClearSlot(slot) : undefined}
          onSubmitForReview={() => {
            const task = detailBySlot.get(slot);
            if (!task) return;
            if (task.status !== "IN_PROGRESS") {
              toast({ level: "warn", title: "Only IN_PROGRESS tasks can be submitted" });
              return;
            }
            if (onOpenTask) onOpenTask(task.project_slug, task.id);
          }}
          onForceRelease={() => {
            const task = detailBySlot.get(slot);
            if (!task || task.status !== "IN_PROGRESS") {
              toast({ level: "warn", title: "Force release requires IN_PROGRESS" });
              return;
            }
            forceRelease.mutate(
              { id: task.id },
              {
                onSuccess: () => toast({ level: "info", title: "Lease reclaimed", body: "Task returned to PENDING." }),
                onError: (error) => toast({ level: "warn", title: "Release failed", body: error.message }),
              },
            );
          }}
          className={cn(slot === focusedSlot && "bg-panel/40")}
        />
      )}
    />
  );
}
