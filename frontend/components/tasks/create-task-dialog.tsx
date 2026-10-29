"use client";

import { useId, useMemo, useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { useCreateTask } from "@/lib/api/queries";
import type { TaskCreateBody } from "@/lib/api/tasks";
import { useAttachmentUpload } from "@/hooks/use-attachment-upload";
import { toast } from "@/hooks/use-toast";
import { clampPriority } from "@/lib/format/priority";
import type { TaskSummaryDTO } from "@/lib/types/api";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { UploadDropzone } from "@/components/tasks/upload-dropzone";

/**
 * Doc 04 §5.2 `POST /projects/{slug}/tasks/` — the only human task-creation path.
 * DoD lines are one-per-line so the textarea maps 1:1 to `dod_items[]`.
 *
 * Attachments are uploaded *after* the task exists (an asset needs a task id),
 * so a failed upload leaves a created task with a warning rather than a
 * half-created task with orphaned bytes.
 */

export type CreateTaskDialogProps = {
  open: boolean;
  slug: string;
  onClose: () => void;
  onCreated?: (task: TaskSummaryDTO) => void;
  keepOpenAfterCreate?: boolean;
  /** Tasks selectable as blockers (`blocked_by[]`). */
  candidates?: readonly TaskSummaryDTO[];
  defaultPriority?: number;
};

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20_000;

export function CreateTaskDialog({
  open,
  slug,
  onClose,
  onCreated,
  keepOpenAfterCreate = true,
  candidates = [],
  defaultPriority = 50,
}: CreateTaskDialogProps) {
  const titleId = useId();
  const create = useCreateTask();
  const attachments = useAttachmentUpload();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(defaultPriority);
  const [dod, setDod] = useState("");
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [createdTitle, setCreatedTitle] = useState<string | null>(null);

  const dodItems = useMemo(
    () => dod.split("\n").map((line) => line.trim()).filter(Boolean),
    [dod],
  );

  const titleError = attempted && title.trim().length === 0 ? "Title is required." : null;
  const descriptionError =
    attempted && description.trim().length === 0 ? "Description is required." : null;

  const reset = () => {
    setTitle("");
    setDescription("");
    setPriority(defaultPriority);
    setDod("");
    setBlockedBy([]);
    setFiles([]);
    setError(null);
    setAttempted(false);
    setCreatedTitle(null);
  };

  const submit = async () => {
    setAttempted(true);
    if (title.trim().length === 0 || description.trim().length === 0) return;
    const body: TaskCreateBody = {
      title: title.trim(),
      description: description.trim(),
      priority: clampPriority(priority),
      ...(dodItems.length > 0 ? { dod_items: dodItems } : {}),
      ...(blockedBy.length > 0 ? { blocked_by: blockedBy } : {}),
    };
    try {
      const task = await create.mutateAsync({ slug, body });
      let uploaded = 0;
      if (files.length > 0) {
        const result = await attachments.upload(task.id, files);
        uploaded = result.done;
        if (result.failed.length > 0) {
          toast({
            level: "warn",
            title: `Task created; ${result.failed.length} image(s) failed`,
            body: result.failed.join(" · "),
          });
        }
      }
      toast({
        level: "info",
        title: `Task created: ${task.title}`,
        body: uploaded > 0 ? `${uploaded} image(s) attached` : undefined,
      });
      onCreated?.(task);
      reset();
      if (keepOpenAfterCreate) {
        setCreatedTitle(task.title);
        requestAnimationFrame(() => document.getElementById(titleId)?.focus());
      } else {
        onClose();
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const busy = create.isPending || attachments.uploading;

  return (
    <Dialog
      open={open}
      title="New task"
      description={`${slug} · creates a PENDING task with a DoD checklist`}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      busy={busy}
      footer={
        <>
          <Button
            size="sm"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={busy}
          >
            Cancel <Kbd size="xs">Esc</Kbd>
          </Button>
          <Button size="sm" variant="primary" onClick={() => void submit()} loading={busy}>
            Create task <Kbd size="xs">⌘↵</Kbd>
          </Button>
        </>
      }
      width="lg"
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      >
        {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}
        {createdTitle ? (
          <p role="status" className="text-hud-micro text-flow">Created “{createdTitle}” — ready for the next one</p>
        ) : null}

        <TextField
          id={titleId}
          label="Title"
          required
          value={title}
          maxLength={TITLE_MAX}
          error={titleError}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Fix JWT expiry race condition"
          autoFocus
        />

        <TextAreaField
          label="Description"
          required
          rows={4}
          value={description}
          maxLength={DESCRIPTION_MAX}
          error={descriptionError}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What is broken, and what does done look like?"
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
            onChange={(event) => setPriority(Number(event.target.value))}
            className="mb-1 h-1 min-w-0 flex-1 cursor-ew-resize accent-[var(--color-flow)]"
          />
        </div>

        <TextAreaField
          label="Definition of done"
          rows={3}
          value={dod}
          onChange={(event) => setDod(event.target.value)}
          placeholder={"One item per line\nRace reproduced under load\nRegression test added"}
          hint={dodItems.length > 0 ? `${dodItems.length} checklist item(s)` : "Optional — one item per line"}
        />

        <UploadDropzone
          files={files}
          onChange={setFiles}
          disabled={busy}
          hint="Screenshots the agent should see — drag & drop, or browse"
        />

        {candidates.length > 0 ? (
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="text-hud-micro uppercase tracking-[0.08em] text-secondary">
              Blocked by {blockedBy.length > 0 ? `(${blockedBy.length})` : ""}
            </legend>
            <div className="max-h-28 overflow-auto rounded-chip border border-grid bg-canvas p-1">
              {candidates.map((task) => {
                const checked = blockedBy.includes(task.id);
                return (
                  <label
                    key={task.id}
                    className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-chip px-1 py-0.5 hover:bg-inset"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setBlockedBy((prev) =>
                          checked ? prev.filter((id) => id !== task.id) : [...prev, task.id],
                        )
                      }
                      className="size-3 accent-[var(--color-flow)]"
                    />
                    <span className="min-w-0 flex-1 truncate font-machine text-machine-sm text-secondary">{task.title}</span>
                    <span className="shrink-0 font-machine text-hud-micro tabular-nums text-muted">P{task.priority}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </form>
    </Dialog>
  );
}
