"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { useDeleteTask } from "@/lib/api/queries";
import { toast } from "@/hooks/use-toast";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

/**
 * The shared "delete this task" confirmation.
 *
 * Delete is fenced server-side (Doc 01 §8 T12): only a task no agent has claimed
 * and that carries no stored assets can be hard-deleted. The card and the list
 * row have no detail payload, so this dialog does not pre-judge — it explains
 * the rule, runs the mutation, and shows the server's verbatim guard reason when
 * it refuses. Archiving is offered as the non-destructive alternative.
 */

export type DeleteTaskDialogProps = {
  open: boolean;
  taskId: string;
  taskTitle: string;
  onClose: () => void;
  onDeleted?: (id: string) => void;
  /** Optional: file it away instead. Omit to hide the alternative. */
  onArchive?: () => void;
};

export function DeleteTaskDialog({
  open,
  taskId,
  taskTitle,
  onClose,
  onDeleted,
  onArchive,
}: DeleteTaskDialogProps) {
  const remove = useDeleteTask();
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await remove.mutateAsync({ id: taskId });
      toast({ level: "warn", title: `Task deleted: ${taskTitle}` });
      onDeleted?.(taskId);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      title="Delete task"
      description={`${taskId.slice(0, 8)} · cannot be undone`}
      onClose={() => (remove.isPending ? undefined : onClose())}
      busy={remove.isPending}
      width="sm"
      footer={
        <>
          {onArchive ? (
            <Button size="sm" variant="ghost" onClick={onArchive} disabled={remove.isPending}>
              Archive instead
            </Button>
          ) : null}
          <span className="min-w-0 flex-1" />
          <Button size="sm" onClick={onClose} disabled={remove.isPending}>
            Cancel <Kbd size="xs">Esc</Kbd>
          </Button>
          <Button size="sm" variant="danger" onClick={() => void submit()} loading={remove.isPending}>
            Delete permanently
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}
        <p className="text-hud-body text-primary">
          Delete <span className="font-machine">{taskTitle}</span> permanently?
        </p>
        <p className="text-hud-micro text-secondary">
          The task folder is removed with the row. Only a task no agent has claimed and that carries no
          attachments can be deleted — archive anything else and it stays recoverable.
        </p>
      </div>
    </Dialog>
  );
}
