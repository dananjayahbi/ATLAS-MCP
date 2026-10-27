"use client";

import Link from "next/link";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { formatPriority } from "@/lib/format/priority";
import type { AssetDTO } from "@/lib/types/enums";
import type { TaskStatus } from "@/lib/types/enums";
import type { TaskDetailDTO } from "@/lib/types/api";
import { AnnotationCanvasModal } from "@/components/tasks/annotation-canvas-modal";
import { AttachmentChips } from "@/components/tasks/attachment-chips";
import { AttachmentUploadPanel } from "@/components/tasks/attachment-upload-panel";
import { AssigneeEditor } from "@/components/tasks/assignee-editor";
import { PrioritySlider } from "@/components/tasks/priority-slider";
import { ReviewActions } from "@/components/tasks/review-actions";
import { STATUS_META } from "@/lib/format/tone";
import { StatusMenu } from "@/components/tasks/status-menu";
import { TaskMeta } from "@/components/tasks/task-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, modKey } from "@/components/ui/kbd";
import { Panel } from "@/components/ui/panel";

/** Doc 06 §7.2 / §10 — right column of the task detail view. */

export type TaskDetailSidebarProps = {
  task: TaskDetailDTO;
  /** Asset open in the full Doc 07 review canvas, or null. */
  canvasAsset: AssetDTO | null;
  onOpenCanvas: (asset: AssetDTO) => void;
  onOpenMarkup: (asset: AssetDTO) => void;
  onCloseCanvas: () => void;
  priorityOpen: boolean;
  onPriorityOpenChange: (open: boolean) => void;
  onCommitPriority: (priority: number) => void;
  onApprove: () => Promise<unknown>;
  onReject: (notes: string) => Promise<unknown>;
  onRequeue: () => void;
  onSetStatus: (status: TaskStatus) => void;
  statusBusy?: boolean;
  onError: (message: string | null) => void;
  imageAsset: AssetDTO | null;
  /** Refreshes after an upload so the new asset appears without a reload. */
  onAssetAdded?: () => void;
};

export function TaskDetailSidebar({
  task,
  canvasAsset,
  onOpenCanvas,
  onOpenMarkup,
  onCloseCanvas,
  priorityOpen,
  onPriorityOpenChange,
  onCommitPriority,
  onApprove,
  onReject,
  onRequeue,
  onSetStatus,
  statusBusy = false,
  onError,
  imageAsset,
  onAssetAdded,
}: TaskDetailSidebarProps) {
  useHotkeys(
    [
      { key: "p", scopes: ["pane"], run: () => onPriorityOpenChange(!priorityOpen) },
      { key: "o", scopes: ["pane"], run: () => imageAsset && onOpenMarkup(imageAsset) },
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
        <AttachmentChips assets={task.assets} onOpenCanvas={onOpenMarkup} />
        {imageAsset ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => onOpenMarkup(imageAsset)}>
              Mark up
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onOpenCanvas(imageAsset)}>
              Review canvas
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-hud-micro text-disabled">
            Attach a screenshot to enable markup.
          </p>
        )}
        <AttachmentUploadPanel taskId={task.id} onUploaded={onAssetAdded} disabled={locked} />
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

      <Panel panelId="status" title="Status" meta={STATUS_META[task.status].label}>
        <StatusMenu
          status={task.status}
          onChange={onSetStatus}
          busy={statusBusy}
          disabled={statusBusy}
        />
      </Panel>

      <Panel panelId="assignee" title="Assignment" meta={task.assigned_agent_id ?? "unassigned"}>
        <AssigneeEditor task={task} />
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
        <AnnotationCanvasModal
          taskId={task.id}
          asset={canvasAsset}
          locked={locked}
          onClose={onCloseCanvas}
          onError={onError}
        />
      ) : null}

      <p className="text-hud-micro uppercase tracking-[0.06em] text-disabled">
        <Link href={`/projects/${task.project_slug}`} className="hover:text-primary">
          ← back to board
        </Link>
      </p>
    </div>
  );
}
