"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { formatPriority } from "@/lib/format/priority";
import type { AssetDTO } from "@/lib/types/enums";
import type { TaskDetailDTO } from "@/lib/types/api";
import { AttachmentChips } from "@/components/tasks/attachment-chips";
import { PrioritySlider } from "@/components/tasks/priority-slider";
import { ReviewActions } from "@/components/tasks/review-actions";
import { TaskMeta } from "@/components/tasks/task-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, modKey } from "@/components/ui/kbd";
import { Panel } from "@/components/ui/panel";

/** Doc 06 §7.2 / §10 — right column of the task detail view. */

const AnnotationCanvas = dynamic(() => import("@/components/canvas/AnnotationCanvas"), { ssr: false });

export type TaskDetailSidebarProps = {
  task: TaskDetailDTO;
  canvasAsset: AssetDTO | null;
  onOpenCanvas: (asset: AssetDTO) => void;
  onCloseCanvas: () => void;
  priorityOpen: boolean;
  onPriorityOpenChange: (open: boolean) => void;
  onCommitPriority: (priority: number) => void;
  onApprove: () => Promise<unknown>;
  onReject: (notes: string) => Promise<unknown>;
  onRequeue: () => void;
  onError: (message: string | null) => void;
  imageAsset: AssetDTO | null;
};

export function TaskDetailSidebar({
  task,
  canvasAsset,
  onOpenCanvas,
  onCloseCanvas,
  priorityOpen,
  onPriorityOpenChange,
  onCommitPriority,
  onApprove,
  onReject,
  onRequeue,
  onError,
  imageAsset,
}: TaskDetailSidebarProps) {
  useHotkeys(
    [
      { key: "p", scopes: ["pane"], run: () => onPriorityOpenChange(!priorityOpen) },
      { key: "o", scopes: ["pane"], run: () => imageAsset && onOpenCanvas(imageAsset) },
    ],
    { scopeStack: ["pane", "global"] },
  );

  const locked = task.status === "IN_REVIEW" || task.status === "COMPLETED";

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Panel panelId="meta" title="Task meta">
        <TaskMeta task={task} />
      </Panel>

      <Panel panelId="attachments" title="Attachments" meta={`${task.assets.length}`}>
        <AttachmentChips assets={task.assets} onOpenCanvas={onOpenCanvas} />
      </Panel>

      <Panel
        panelId="priority"
        title="Priority"
        meta={formatPriority(task.priority)}
        actions={
          <Button size="sm" onClick={() => onPriorityOpenChange(!priorityOpen)} aria-expanded={priorityOpen}>
            {priorityOpen ? "Hide" : "Edit"} <Kbd size="xs">P</Kbd>
          </Button>
        }
      >
        {priorityOpen ? (
          <PrioritySlider value={task.priority} suggested={task.suggested_priority} onCommit={onCommitPriority} />
        ) : (
          <p className="text-hud-body text-muted">
            Current priority <span className="font-machine text-machine">{formatPriority(task.priority)}</span>
            {task.suggested_priority !== null ? (
              <span className="ml-2 text-review-hot">suggested {formatPriority(task.suggested_priority)}</span>
            ) : null}
          </p>
        )}
      </Panel>

      <Panel panelId="review" title="Review actions" meta={task.status}>
        {task.review_summary ? (
          <div className="mb-2">
            <p className="text-hud-micro uppercase tracking-[0.08em] text-disabled">Summary</p>
            <p className="text-hud-body text-secondary">{task.review_summary}</p>
          </div>
        ) : null}
        {task.review_notes ? (
          <div className="mb-2">
            <p className="text-hud-micro uppercase tracking-[0.08em] text-disabled">Notes</p>
            <p className="text-hud-body text-secondary">{task.review_notes}</p>
          </div>
        ) : null}
        <ReviewActions
          task={task}
          disabled={task.status !== "IN_REVIEW"}
          onApprove={onApprove}
          onReject={onReject}
        />
        <p className="mt-2 text-hud-micro uppercase tracking-[0.06em] text-disabled">
          Sign-off <Kbd size="xs">{modKey()}</Kbd>
          <Kbd size="xs">↵</Kbd> · Reject <Kbd size="xs">R</Kbd> · Force release <Kbd size="xs">F</Kbd>
        </p>
      </Panel>

      {task.status === "REJECTED" ? (
        <Panel panelId="requeue" title="Rejected">
          <p className="mb-2 text-hud-body text-secondary">Requeue returns this task to PENDING (T13).</p>
          <Button size="sm" onClick={onRequeue}>
            Requeue
          </Button>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        <Badge tone="neutral">attempts {task.attempt_count}</Badge>
        <Badge tone="neutral">dep {task.dependency_weight}</Badge>
        {task.is_blocked ? <Badge tone="review">BLOCKED</Badge> : null}
        {task.is_agent_discovered ? <Badge tone="review">DISCOVERED</Badge> : null}
        {task.parent_task_id ? <Badge tone="neutral">SUBTASK</Badge> : null}
      </div>

      {canvasAsset ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Annotation canvas"
          className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-scrim)] p-6"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-hud border border-grid-strong bg-panel p-3">
            <div className="flex shrink-0 items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-hud-label uppercase tracking-[0.06em] text-primary">
                {canvasAsset.filename}
              </h2>
              <Button size="sm" onClick={onCloseCanvas}>
                Close <Kbd size="xs">Esc</Kbd>
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <AnnotationCanvas
                taskId={task.id}
                sourceAsset={canvasAsset}
                mode={locked ? "review" : "create"}
                className="h-full min-h-[60vh]"
                onExport={() => onCloseCanvas()}
                onError={(canvasError) => onError(canvasError.message)}
              />
            </div>
          </div>
        </div>
      ) : null}

      <p className="text-hud-micro uppercase tracking-[0.06em] text-disabled">
        <Link href={`/projects/${task.project_slug}`} className="hover:text-primary">
          ← back to board
        </Link>
      </p>
    </div>
  );
}
