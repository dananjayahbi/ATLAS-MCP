"use client";

import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { useDeleteTask, useUpdateTask } from "@/lib/api/queries";
import type { TaskUpdateBody } from "@/lib/api/tasks";
import { toast } from "@/hooks/use-toast";
import { clampPriority } from "@/lib/format/priority";
import type { TaskDetailDTO, TaskSummaryDTO } from "@/lib/types/api";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";

/**
 * Edit and delete an existing task.
 *
 * Fields map 1:1 onto `PATCH /tasks/{id}/`; status is deliberately absent here
 * because it lives in `StatusMenu` (one implementation per transition,
 * Doc 01 §8). Delete is offered only for tasks the server will actually delete.
 */

export type EditTaskDialogProps = {
  open: boolean;
  task: TaskDetailDTO;
  onClose: () => void;
  onSaved?: (task: TaskDetailDTO) => void;
  onDeleted?: (id: string) => void;
  /** Tasks selectable as blockers. */
  candidates?: readonly TaskSummaryDTO[];
};

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20_000;

export function EditTaskDialog({
  open,
  task,
  onClose,
  onSaved,
  onDeleted,
  candidates = [],
}: EditTaskDialogProps) {
  const update = useUpdateTask();
  const remove = useDeleteTask();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState(task.priority);
  const [dod, setDod] = useState(task.definition_of_done.map((item) => item.label).join("\n"));
  const [blockedBy, setBlockedBy] = useState<string[]>(task.blocked_by);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-seed when the operator opens the dialog for a different task.
  useEffect(() => {
    if (!open) return;
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    setDod(task.definition_of_done.map((item) => item.label).join("\n"));
    setBlockedBy(task.blocked_by);
    setError(null);
    setConfirmDelete(false);
  }, [open, task]);

  const dodItems = useMemo(
    () => dod.split("\n").map((line) => line.trim()).filter(Boolean),
    [dod],
  );

  const locked = task.status === "COMPLETED";
  const deletable = (task.status === "PENDING" || task.status === "REJECTED") && task.attempt_count === 0;

  const dirty =
    title.trim() !== task.title ||
    description.trim() !== task.description ||
    priority !== task.priority ||
    dodItems.join("\n") !== task.definition_of_done.map((item) => item.label).join("\n") ||
    blockedBy.join(",") !== task.blocked_by.join(",");

  const submit = async () => {
    if (locked) return;
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required.");
      return;
    }
    const body: TaskUpdateBody = {};
    if (title.trim() !== task.title) body.title = title.trim();
    if (description.trim() !== task.description) body.description = description.trim();
    if (priority !== task.priority) body.priority = clampPriority(priority);
    if (dodItems.join("\n") !== task.definition_of_done.map((i) => i.label).join("\n")) {
      body.dod_items = dodItems;
    }
    if (blockedBy.join(",") !== task.blocked_by.join(",")) body.blocked_by = blockedBy;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    try {
      const saved = await update.mutateAsync({ id: task.id, body });
      toast({ level: "info", title: "Task updated" });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const doDelete = async () => {
    try {
      await remove.mutateAsync({ id: task.id });
      toast({ level: "warn", title: `Task deleted: ${task.title}` });
      onDeleted?.(task.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      title="Edit task"
      description={`${task.project_slug} · ${task.status.replace("_", " ").toLowerCase()}`}
      onClose={() => {
        if (update.isPending || remove.isPending) return;
        onClose();
      }}
      busy={update.isPending || remove.isPending}
      width="lg"
      footer={
        <>
          {deletable && !confirmDelete ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={locked}>
              Delete…
            </Button>
          ) : null}
          <span className="min-w-0 flex-1" />
          <Button size="sm" onClick={onClose} disabled={update.isPending || remove.isPending}>
            Cancel <Kbd size="xs">Esc</Kbd>
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void submit()}
            loading={update.isPending}
            disabled={locked || !dirty || confirmDelete}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}
        {locked ? (
          <AlertBanner severity="info">
            This task is completed. Its content is evidence, so editing is disabled — requeue it to make it
            editable again.
          </AlertBanner>
        ) : null}

        {confirmDelete ? (
          <div className="rounded-hud border border-critical/50 bg-critical-tint p-2">
            <p className="text-hud-body text-primary">
              Delete <span className="font-machine">{task.title}</span> permanently?
            </p>
            <p className="mt-1 text-hud-micro text-secondary">
              Only tasks no agent has claimed can be deleted. The task folder is removed with it; this cannot
              be undone.
            </p>
            <div className="mt-1 flex items-center gap-1">
              <Button size="sm" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
                Keep it
              </Button>
              <Button size="sm" variant="danger" onClick={() => void doDelete()} loading={remove.isPending}>
                Delete permanently
              </Button>
            </div>
          </div>
        ) : null}

        <TextField
          label="Title"
          required
          value={title}
          maxLength={TITLE_MAX}
          disabled={locked || confirmDelete}
          onChange={(event) => setTitle(event.target.value)}
          data-autofocus
        />

        <TextAreaField
          label="Description"
          required
          rows={5}
          value={description}
          maxLength={DESCRIPTION_MAX}
          disabled={locked || confirmDelete}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className="flex items-end gap-2">
          <TextField
            label="Priority"
            type="number"
            min={0}
            max={100}
            step={1}
            value={priority}
            fieldClassName="w-28"
            disabled={locked || confirmDelete}
            onChange={(event) => setPriority(Number(event.target.value))}
            hint="0–100, higher wins the queue"
          />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={clampPriority(priority)}
            aria-label="Priority slider"
            disabled={locked || confirmDelete}
            onChange={(event) => setPriority(Number(event.target.value))}
            className="mb-1 h-1 min-w-0 flex-1 cursor-ew-resize accent-[var(--color-flow)]"
          />
        </div>

        <TextAreaField
          label="Definition of done"
          rows={4}
          value={dod}
          disabled={locked || confirmDelete}
          onChange={(event) => setDod(event.target.value)}
          hint={`${dodItems.length} item(s) · completion is carried across edits by label`}
        />

        {candidates.length > 0 ? (
          <fieldset className="flex min-w-0 flex-col gap-1" disabled={locked || confirmDelete}>
            <legend className="text-hud-micro uppercase tracking-[0.08em] text-secondary">
              Blocked by {blockedBy.length > 0 ? `(${blockedBy.length})` : ""}
            </legend>
            <div className="max-h-32 overflow-auto rounded-chip border border-grid bg-canvas p-1">
              {candidates
                .filter((candidate) => candidate.id !== task.id)
                .map((candidate) => {
                  const checked = blockedBy.includes(candidate.id);
                  return (
                    <label
                      key={candidate.id}
                      className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-chip px-1 py-0.5 hover:bg-inset"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setBlockedBy((prev) =>
                            checked ? prev.filter((id) => id !== candidate.id) : [...prev, candidate.id],
                          )
                        }
                        className="size-3 accent-[var(--color-flow)]"
                      />
                      <span className="min-w-0 flex-1 truncate font-machine text-machine-sm text-secondary">
                        {candidate.title}
                      </span>
                      <span className="shrink-0 font-machine text-hud-micro tabular-nums text-muted">
                        P{candidate.priority}
                      </span>
                    </label>
                  );
                })}
            </div>
          </fieldset>
        ) : null}
      </div>
    </Dialog>
  );
}
