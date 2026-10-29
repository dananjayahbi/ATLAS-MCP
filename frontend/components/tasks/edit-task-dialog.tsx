"use client";

import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { useArchiveTask, useDeleteTask, useUpdateTask } from "@/lib/api/queries";
import type { TaskUpdateBody } from "@/lib/api/tasks";
import { toast } from "@/hooks/use-toast";
import { clampPriority } from "@/lib/format/priority";
import type { TaskDetailDTO, TaskSummaryDTO } from "@/lib/types/api";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { TaskAssetsEditor } from "./task-assets-editor";

/**
 * Edit and delete an existing task.
 *
 * Fields map 1:1 onto `PATCH /tasks/{id}/`; status is deliberately absent here
 * because it lives in `StatusMenu` (one implementation per transition,
 * Doc 01 §8). The destructive and archival actions are always visible in the
 * footer — an operator looking for "delete" should not have to find it behind
 * a hover state.
 */

export type EditTaskDialogProps = {
  open: boolean;
  task: TaskDetailDTO;
  onClose: () => void;
  onSaved?: (task: TaskDetailDTO) => void;
  onDeleted?: (id: string) => void;
  /** Fires after a successful archive, so the caller can drop the row. */
  onArchived?: (id: string) => void;
  /** Fires after an image is added or removed, so thumbnails can resync. */
  onAssetsChanged?: (id: string) => void;
  /** Tasks selectable as blockers. */
  candidates?: readonly TaskSummaryDTO[];
};

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20_000;

/** The server's hard-delete fence (Doc 01 §8 T12), mirrored so the UI can explain it. */
export function canHardDelete(task: TaskDetailDTO): boolean {
  if (task.status !== "PENDING" && task.status !== "REJECTED") return false;
  if (task.attempt_count > 0) return false;
  return task.assets.length === 0;
}

/** Tasks can be archived from any status. */
export function canArchive(_task: TaskDetailDTO): boolean {
  return true;
}

export function EditTaskDialog({
  open,
  task,
  onClose,
  onSaved,
  onDeleted,
  onArchived,
  onAssetsChanged,
  candidates = [],
}: EditTaskDialogProps) {
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const archive = useArchiveTask();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState(task.priority);
  const [dod, setDod] = useState(task.definition_of_done.map((item) => item.label).join("\n"));
  const [blockedBy, setBlockedBy] = useState<string[]>(task.blocked_by);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

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
    setConfirmArchive(false);
  }, [open, task]);

  const dodItems = useMemo(
    () => dod.split("\n").map((line) => line.trim()).filter(Boolean),
    [dod],
  );

  const locked = task.status === "COMPLETED";
  const deletable = canHardDelete(task);
  const archivable = canArchive(task);
  const busy = update.isPending || remove.isPending || archive.isPending;

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

  const doArchive = async () => {
    try {
      await archive.mutateAsync({ id: task.id, archived: true });
      toast({ level: "warn", title: `Task archived: ${task.title}` });
      onArchived?.(task.id);
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
        if (busy) return;
        onClose();
      }}
      busy={busy}
      width="lg"
      footer={
        <>
          {/*
            Both destructive actions are always visible: the report was "I still
            can't find the delete button". They stay disabled — with the reason
            in the dialog body — when the server would refuse.
          */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirmArchive(true);
              setConfirmDelete(false);
            }}
            disabled={!archivable || busy || confirmArchive}
            title="Archive this task (reversible)"
          >
            Archive
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setConfirmDelete(true);
              setConfirmArchive(false);
            }}
            disabled={busy || confirmDelete}
            title={deletable ? "Delete permanently" : "Claimed tasks or tasks with attachments must be archived"}
          >
            Delete…
          </Button>
          <span className="min-w-0 flex-1" />
          <Button size="sm" onClick={onClose} disabled={busy}>
            Cancel <Kbd size="xs">Esc</Kbd>
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void submit()}
            loading={update.isPending}
            disabled={locked || !dirty || confirmDelete || confirmArchive}
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

        {confirmArchive ? (
          <div className="rounded-hud border border-flow/40 bg-flow-tint p-2">
            <p className="text-hud-body text-primary">
              Archive <span className="font-machine">{task.title}</span>?
            </p>
            <p className="mt-1 text-hud-micro text-secondary">
              It leaves the board and every queue, and stays recoverable from the Archive page. Nothing is
              deleted.
            </p>
            <div className="mt-1 flex items-center gap-1">
              <Button size="sm" onClick={() => setConfirmArchive(false)} disabled={archive.isPending}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => void doArchive()} loading={archive.isPending}>
                Archive task
              </Button>
            </div>
          </div>
        ) : null}

        {confirmDelete ? (
          <div className="rounded-hud border border-critical/50 bg-critical-tint p-2">
            <p className="text-hud-body text-primary">
              Delete <span className="font-machine">{task.title}</span> permanently?
            </p>
            <p className="mt-1 text-hud-micro text-secondary">
              {deletable
                ? "The task folder is removed with the row; this cannot be undone. Archive instead if you may want it back."
                : "Only tasks no agent has claimed and that carry no attachments can be deleted. Archive this one instead."}
            </p>
            <div className="mt-1 flex items-center gap-1">
              <Button size="sm" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
                Keep it
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void doDelete()}
                loading={remove.isPending}
                disabled={!deletable}
              >
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

        {/* Images live here so add/remove is one surface, not a sidebar round trip. */}
        <TaskAssetsEditor
          taskId={task.id}
          projectSlug={task.project_slug}
          disabled={locked || confirmDelete || confirmArchive}
          onChanged={() => onAssetsChanged?.(task.id)}
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
