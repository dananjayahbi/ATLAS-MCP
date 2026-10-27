"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/format/cn";
import { formatCountdown } from "@/lib/format/duration";
import { LEASE_CLASS, leaseTone } from "@/lib/format/tone";
import type { TaskDetailDTO } from "@/lib/types/api";
import type { AssetDTO } from "@/lib/types/enums";
import { Gauge } from "@/components/ui/gauge";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { isImageAsset } from "@/components/tasks/attachment-chips";

/** Doc 06 §7.2 rows 2–5 — DoD, attachments, terminal and action bar of a pane. */

const AnnotationCanvas = dynamic(() => import("@/components/canvas/AnnotationCanvas"), { ssr: false });
const AgentLogStream = dynamic(() => import("@/components/terminal/AgentLogStream"), { ssr: false });

export type AgentPaneBodyProps = {
  task: TaskDetailDTO;
  canvasAsset: AssetDTO | null;
  onCanvasChange: (asset: AssetDTO | null) => void;
  onSubmitForReview?: () => void;
  onForceRelease?: () => void;
  locked: boolean;
};

export function AgentPaneBody({
  task,
  canvasAsset,
  onCanvasChange,
  onSubmitForReview,
  onForceRelease,
  locked,
}: AgentPaneBodyProps) {
  const sourceAsset =
    task.assets.find((asset) => asset.kind === "INPUT_SCREENSHOT") ?? task.assets.find(isImageAsset) ?? null;

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-2 py-1">
        <Gauge
          value={task.dod_progress_percent}
          items={task.definition_of_done}
          size="sm"
          className="min-w-0 flex-1"
          label="Definition of done"
        />
        <span
          className={cn(
            "shrink-0 font-machine text-hud-micro tabular-nums",
            LEASE_CLASS[leaseTone(task.lease_seconds_remaining)],
          )}
        >
          ⏱ {formatCountdown(task.lease_seconds_remaining)}
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 pb-1">
        {task.assets.length === 0 ? (
          <span className="text-hud-micro uppercase text-disabled">No attachments</span>
        ) : (
          task.assets.slice(0, 4).map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => isImageAsset(asset) && onCanvasChange(asset)}
              disabled={!isImageAsset(asset)}
              title={asset.filename}
              className={cn(
                "max-w-36 truncate rounded-chip border border-grid bg-inset px-1.5 font-machine text-hud-micro",
                isImageAsset(asset) ? "text-flow hover:border-flow" : "text-muted",
              )}
            >
              {asset.filename}
            </button>
          ))
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden border-y border-grid">
        <AgentLogStream taskId={task.id} title={task.title} className="h-full" />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1">
        <Button
          size="sm"
          onClick={onSubmitForReview}
          disabled={task.status !== "IN_PROGRESS"}
          title={task.status === "IN_PROGRESS" ? "Submit for review" : "Only IN_PROGRESS tasks can be submitted"}
        >
          Submit <Kbd size="xs">⌘↵</Kbd>
        </Button>
        <Button
          size="sm"
          onClick={() => sourceAsset && onCanvasChange(sourceAsset)}
          disabled={!sourceAsset}
          title={sourceAsset ? "Open annotation canvas" : "No image asset on this task"}
        >
          Canvas <Kbd size="xs">O</Kbd>
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={onForceRelease}
          disabled={task.status !== "IN_PROGRESS"}
          title="Force release (F) — returns the task to PENDING"
        >
          Release <Kbd size="xs">F</Kbd>
        </Button>
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
              <Button size="sm" onClick={() => onCanvasChange(null)}>
                Close <Kbd size="xs">Esc</Kbd>
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <AnnotationCanvas
                taskId={task.id}
                sourceAsset={canvasAsset}
                mode={locked ? "review" : "create"}
                className="h-full min-h-[60vh]"
                onExport={() => onCanvasChange(null)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
