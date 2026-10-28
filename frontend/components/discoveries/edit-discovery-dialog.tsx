"use client";

import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { useUpdateDiscovery } from "@/lib/api/queries";
import type { DiscoveryUpdateBody } from "@/lib/api/discoveries";
import { clampPriority } from "@/lib/format/priority";
import type { DiscoveryDTO } from "@/lib/types/api";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { PrioritySlider } from "@/components/tasks/priority-slider";
import { DiscoveryAssetsEditor } from "./discovery-assets-editor";

/**
 * Correct a discovery before approving it.
 *
 * Approving invests the agent's text as the task brief, so the operator owns
 * every field the proposal carries — not just the priority. Fields map 1:1 onto
 * `PATCH /discoveries/{id}/`; `status` is absent because approve/reject/restore
 * own the transitions (one implementation per move, Doc 01 §8).
 */

export type EditDiscoveryDialogProps = {
  open: boolean;
  discovery: DiscoveryDTO | null;
  onClose: () => void;
  onSaved?: (discovery: DiscoveryDTO) => void;
  /** Re-read the row after an image is added or removed. */
  onAssetsChanged?: () => void;
  /** Approve at the (possibly just-edited) priority, straight from the dialog. */
  onApprove?: (discovery: DiscoveryDTO, priority: number) => Promise<unknown>;
};

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20_000;

export function EditDiscoveryDialog({
  open,
  discovery,
  onClose,
  onSaved,
  onAssetsChanged,
  onApprove,
}: EditDiscoveryDialogProps) {
  const update = useUpdateDiscovery();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState(50);
  const [dod, setDod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  // Re-seed per discovery: the dialog is reused for whatever row is selected.
  useEffect(() => {
    if (!open || !discovery) return;
    setTitle(discovery.title);
    setDescription(discovery.description);
    setReason(discovery.discovery_reason);
    setPriority(discovery.priority);
    setDod((discovery.definition_of_done ?? []).map((item) => item.label).join("\n"));
    setError(null);
    setApproving(false);
  }, [open, discovery]);

  if (!discovery) return null;

  const busy = update.isPending || approving;

  const dodItems = () =>
    dod
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const body = (): DiscoveryUpdateBody => {
    const next: DiscoveryUpdateBody = {};
    if (title.trim() !== discovery.title) next.title = title.trim();
    if (description !== discovery.description) next.description = description;
    if (reason !== discovery.discovery_reason) next.discovery_reason = reason;
    if (priority !== discovery.priority) next.priority = priority;
    const current = (discovery.definition_of_done ?? []).map((item) => item.label);
    const edited = dodItems();
    if (edited.join("\n") !== current.join("\n")) next.dod_items = edited;
    return next;
  };

  const save = async (): Promise<DiscoveryDTO | null> => {
    setError(null);
    if (title.trim().length === 0) {
      setError("Title cannot be empty.");
      return null;
    }
    const payload = body();
    if (Object.keys(payload).length === 0) return discovery;
    try {
      const saved = await update.mutateAsync({ id: discovery.task_id, body: payload });
      onSaved?.(saved);
      return saved;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  };

  const saveAndApprove = async () => {
    setApproving(true);
    const saved = await save();
    // A failed save must not approve a half-edited proposal.
    if (!saved) {
      setApproving(false);
      return;
    }
    try {
      await onApprove?.(saved, priority);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setApproving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Edit discovery"
      description={`${discovery.discovered_by_agent} · ${discovery.project_slug}`}
      onClose={onClose}
      busy={busy}
      width="lg"
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              const saved = await save();
              if (saved) onClose();
            }}
            loading={update.isPending}
            disabled={busy}
          >
            Save
          </Button>
          {onApprove ? (
            <Button size="sm" variant="primary" onClick={() => void saveAndApprove()} loading={approving} disabled={busy}>
              Save &amp; approve
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-2">
        {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}

        <TextField
          label="Title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          hint={`${title.length}/${TITLE_MAX}`}
        />

        <TextAreaField
          label="Description"
          value={description}
          rows={10}
          maxLength={DESCRIPTION_MAX}
          onChange={(event) => setDescription(event.target.value)}
        />

        <TextAreaField
          label="Discovery reason"
          value={reason}
          rows={2}
          onChange={(event) => setReason(event.target.value)}
          hint="Why the agent proposed this; kept as audit context."
        />

        <TextAreaField
          label="Definition of done"
          value={dod}
          rows={4}
          onChange={(event) => setDod(event.target.value)}
          hint="One item per line. Reordering or removing items is allowed."
        />

        <div className="flex flex-col gap-1">
          <span className="text-hud-micro uppercase tracking-[0.08em] text-secondary">Priority</span>
          <PrioritySlider
            value={clampPriority(priority)}
            suggested={discovery.suggested_priority}
            onCommit={setPriority}
          />
        </div>

        <DiscoveryAssetsEditor
          taskId={discovery.task_id}
          assets={discovery.assets ?? []}
          disabled={busy}
          onChanged={onAssetsChanged}
        />
      </div>
    </Dialog>
  );
}
