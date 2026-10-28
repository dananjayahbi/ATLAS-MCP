"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/api/errors";
import {
  useApproveReview,
  useForceRelease,
  useRejectReview,
  useSetPriority,
  useSetTaskStatus,
  useTask,
  useToggleDod,
} from "@/lib/api/queries";
import { assetsApi } from "@/lib/api/assets";
import { tasksApi } from "@/lib/api/tasks";
import { toast } from "@/hooks/use-toast";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { AssetDTO } from "@/lib/types/enums";
import { PageShell } from "@/components/hud/hud-frame";
import { isImageAsset } from "@/components/tasks/attachment-chips";
import { EditTaskDialog } from "@/components/tasks/edit-task-dialog";
import { MarkupModal, type MarkupImageEntry } from "@/components/markup/markup-modal";
import { TaskDetailMain } from "@/components/tasks/task-detail-main";
import { TaskDetailSidebar } from "@/components/tasks/task-detail-sidebar";
import { AlertBanner } from "@/components/ui/alert-banner";
import { PriorityChip, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/** Doc 06 §7.2 / §10 — task detail composition. */

export type TaskDetailProps = {
  taskId: string;
  className?: string;
};

export function TaskDetail({ taskId, className }: TaskDetailProps) {
  const router = useRouter();
  const query = useTask(taskId);
  const setPriority = useSetPriority();
  const setStatus = useSetTaskStatus();
  const toggleDod = useToggleDod();
  const approve = useApproveReview();
  const reject = useRejectReview();
  const forceRelease = useForceRelease();
  const [markupAssetId, setMarkupAssetId] = useState<string | null>(null);
  const [reviewAsset, setReviewAsset] = useState<AssetDTO | null>(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const task = query.data;

  const imageAsset = useMemo(
    () => task?.assets.find((asset) => asset.kind === "INPUT_SCREENSHOT") ?? task?.assets.find(isImageAsset) ?? null,
    [task],
  );

  /**
   * Every image on the task, in the order the markup rail shows them. The
   * annotated copies are excluded: they are burn-in output, not a canvas you
   * would keep marking over.
   */
  const markupImages: MarkupImageEntry[] = useMemo(
    () =>
      (task?.assets ?? [])
        .filter((asset) => asset.mime_type.startsWith("image/") && asset.kind !== "ANNOTATED_CANVAS")
        .map((asset) => ({
          id: asset.id,
          label: asset.filename,
          url: assetsApi.contentUrl(asset.id),
          kind: asset.kind,
          mimeType: asset.mime_type,
          byteSize: asset.byte_size,
          version: asset.version,
        })),
    [task],
  );

  const openMarkup = useCallback(
    (asset: AssetDTO) => setMarkupAssetId(asset.id),
    [],
  );

  useHotkeys(
    [
      {
        key: "Enter",
        mod: true,
        scopes: ["pane"],
        allowInInput: true,
        run: () => {
          if (!task || task.status !== "IN_REVIEW") return;
          approve.mutate(
            { id: taskId },
            {
              onSuccess: () => toast({ level: "info", title: `Task ${taskId.slice(0, 8)} completed` }),
              onError: (err) => setError(errorMessage(err)),
            },
          );
        },
      },
      {
        key: "f",
        scopes: ["pane"],
        run: () => {
          if (!task || task.status !== "IN_PROGRESS") return;
          forceRelease.mutate({ id: taskId }, { onError: (err) => setError(errorMessage(err)) });
        },
      },
    ],
    { scopeStack: ["pane", "global"] },
  );

  if (query.isLoading && !task) {
    return (
      <PageShell title="Loading task" subtitle={taskId}>
        <Skeleton lines={8} />
      </PageShell>
    );
  }

  if (!task) {
    return (
      <PageShell title="Task unavailable" subtitle={taskId}>
        <EmptyState
          title="Task no longer exists"
          hint="It may have been archived. Return to the board to refresh."
          action={
            <Link href="/" className="rounded-hud border border-grid px-2 py-1 text-hud-label text-flow">
              Back to command center
            </Link>
          }
        />
      </PageShell>
    );
  }

  const unchecked = task.definition_of_done.filter((item) => !item.completed).length;

  return (
    <PageShell
      title={task.title}
      subtitle={`${task.project_slug} · ${task.id.slice(0, 8)}`}
      actions={
        <>
          <PriorityChip priority={task.priority} showLabel />
          <StatusBadge status={task.status} size="md" />
          <Button size="sm" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Link
            href={`/projects/${task.project_slug}`}
            className="rounded-hud border border-grid px-2 py-1 text-hud-micro uppercase text-secondary hover:border-grid-strong hover:text-primary"
          >
            Board
          </Link>
        </>
      }
      className={className}
    >
      <div className="flex min-h-0 flex-col gap-3">
        {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}

        {task.status === "IN_REVIEW" && task.dod_progress_percent < 100 ? (
          <AlertBanner severity="warning">
            DoD incomplete — {unchecked} item(s) unchecked. Sign-off is still permitted (human sign-off is the only hard
            gate).
          </AlertBanner>
        ) : null}

        <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <TaskDetailMain
            task={task}
            onToggleDod={
              task.status === "IN_REVIEW"
                ? (itemId, completed) => toggleDod.mutate({ id: task.id, itemId, completed })
                : undefined
            }
            pendingItemId={toggleDod.isPending ? (toggleDod.variables?.itemId ?? null) : null}
          />

          <TaskDetailSidebar
            task={task}
            canvasAsset={reviewAsset}
            imageAsset={imageAsset}
            onOpenCanvas={setReviewAsset}
            onOpenMarkup={openMarkup}
            onCloseCanvas={() => {
              setReviewAsset(null);
              void query.refetch();
            }}
            priorityOpen={priorityOpen}
            onPriorityOpenChange={setPriorityOpen}
            onCommitPriority={(priority) =>
              setPriority.mutate({ id: task.id, priority }, { onError: (err) => setError(errorMessage(err)) })
            }
            onApprove={() => approve.mutateAsync({ id: task.id })}
            onReject={(notes) => reject.mutateAsync({ id: task.id, notes })}
            onRequeue={() => {
              void tasksApi
                .requeue(task.id)
                .then(() => query.refetch())
                .catch((err: unknown) => setError(errorMessage(err)));
            }}
            onSetStatus={(status) =>
              setStatus.mutate(
                { id: task.id, status, note: status === "PENDING" ? "Reopened by operator." : "" },
                { onError: (err) => setError(errorMessage(err)) },
              )
            }
            statusBusy={setStatus.isPending}
            onAssetAdded={() => void query.refetch()}
            onError={setError}
          />
        </div>
      </div>

      <MarkupModal
        open={markupAssetId !== null}
        taskId={task.id}
        taskTitle={task.title}
        assetId={markupAssetId}
        images={markupImages}
        onClose={() => setMarkupAssetId(null)}
        onSaved={() => void query.refetch()}
      />

      <EditTaskDialog
        open={editOpen}
        task={task}
        onClose={() => setEditOpen(false)}
        onSaved={() => void query.refetch()}
        onDeleted={() => router.push(`/projects/${task.project_slug}`)}
      />
    </PageShell>
  );
}
