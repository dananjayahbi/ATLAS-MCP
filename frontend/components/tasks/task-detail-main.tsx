"use client";

import dynamic from "next/dynamic";
import type { TaskDetailDTO } from "@/lib/types/api";
import { DodList } from "@/components/tasks/dod-list";
import { MarkdownBlock } from "@/components/tasks/markdown-block";
import { RadialGauge } from "@/components/ui/gauge";
import { Panel } from "@/components/ui/panel";

/** Doc 06 §7.2 — left column of the task detail: DoD, description, terminal. */

const AgentLogStream = dynamic(() => import("@/components/terminal/AgentLogStream"), { ssr: false });

export type TaskDetailMainProps = {
  task: TaskDetailDTO;
  onToggleDod?: (itemId: number, completed: boolean) => void;
  pendingItemId?: number | null;
};

export function TaskDetailMain({ task, onToggleDod, pendingItemId = null }: TaskDetailMainProps) {
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Panel panelId="dod" title="Definition of done" meta={`${task.dod_progress_percent}%`}>
        <div className="flex items-start gap-3">
          <RadialGauge value={task.dod_progress_percent} size={84} />
          <div className="min-w-0 flex-1">
            <DodList
              items={task.definition_of_done}
              onToggle={onToggleDod}
              pendingItemId={pendingItemId}
              disabled={pendingItemId !== null}
            />
            {task.status !== "IN_REVIEW" ? (
              <p className="mt-1 text-hud-micro uppercase tracking-[0.06em] text-disabled">
                Read-only here — the agent owns DoD via update_dod_item.
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel panelId="description" title="Description">
        {task.description ? (
          <MarkdownBlock source={task.description} />
        ) : (
          <p className="text-hud-body text-muted">No description.</p>
        )}
      </Panel>

      <Panel panelId="terminal" title="Live agent log" meta={task.assigned_agent_id ?? "—"} bodyClassName="pt-2">
        <div className="h-72">
          <AgentLogStream taskId={task.id} title={task.title} className="h-full" />
        </div>
      </Panel>
    </div>
  );
}
