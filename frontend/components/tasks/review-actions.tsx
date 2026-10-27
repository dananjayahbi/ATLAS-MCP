"use client";

import { useState } from "react";
import { cn } from "@/lib/format/cn";
import { errorMessage } from "@/lib/api/errors";
import { ApiError } from "@/lib/api/client";
import type { TaskDetailDTO } from "@/lib/types/api";
import { Button } from "@/components/ui/button";
import { Kbd, modKey } from "@/components/ui/kbd";

/**
 * Doc 06 §10.5 — sign-off and reject. Sign-off posts an **empty body**; reject posts
 * `{review_notes}` and is blocked client-side when blank (mirrors T9).
 */

export type ReviewActionsProps = {
  task: TaskDetailDTO;
  onApprove: () => Promise<unknown>;
  onReject: (notes: string) => Promise<unknown>;
  disabled?: boolean;
  className?: string;
};

const MAX_NOTES = 4000;

export function ReviewActions({ task, onApprove, onReject, disabled = false, className }: ReviewActionsProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const canSignOff = task.status === "IN_REVIEW" && !disabled;
  const trimmed = notes.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX_NOTES;

  const approve = async () => {
    if (!canSignOff || busy) return;
    setBusy("approve");
    setError(null);
    try {
      await onApprove();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!valid || busy) return;
    setBusy("reject");
    setError(null);
    try {
      await onReject(trimmed);
      setRejectOpen(false);
      setNotes("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const isTransitionError = (err: unknown) => err instanceof ApiError && err.code === "INVALID_TRANSITION";

  return (
    <div className={cn("flex shrink-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={() => void approve()}
          disabled={!canSignOff || busy !== null}
          loading={busy === "approve"}
          title={canSignOff ? `Sign off (${modKey()}+Enter)` : "Only IN_REVIEW tasks can be signed off"}
          aria-describedby={canSignOff ? undefined : "signoff-guard"}
        >
          Sign off <Kbd size="xs" className="ml-1">{modKey()}↵</Kbd>
        </Button>

        <Button
          variant="danger"
          size="md"
          onClick={() => setRejectOpen((open) => !open)}
          disabled={!canSignOff || busy !== null}
          aria-expanded={rejectOpen}
          title="Reject with notes (R)"
        >
          Reject with notes <Kbd size="xs" className="ml-1">R</Kbd>
        </Button>

        {!canSignOff ? (
          <span id="signoff-guard" className="text-hud-micro uppercase text-disabled">
            {disabled ? "Action unavailable" : `Task is ${task.status}`}
          </span>
        ) : null}
      </div>

      {rejectOpen ? (
        <div className="flex flex-col gap-1 rounded-hud border border-grid bg-inset/60 p-2">
          <label htmlFor="reject-notes" className="text-hud-micro uppercase tracking-[0.08em] text-secondary">
            Review notes (required to reject — T9)
          </label>
          <textarea
            id="reject-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value.slice(0, MAX_NOTES))}
            rows={3}
            maxLength={MAX_NOTES}
            aria-invalid={!valid && notes.length > 0}
            aria-describedby="reject-help"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void reject();
              }
            }}
            className="w-full resize-y rounded-chip border border-grid bg-canvas px-2 py-1 font-machine text-machine-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
            placeholder="What must change before this can pass?"
          />
          <div className="flex items-center justify-between gap-2">
            <p id="reject-help" className="text-hud-micro text-muted">
              Returns the task to <span className="font-machine text-machine">PENDING</span>; attempt_count is unchanged.
              <span className="ml-1 tabular-nums text-disabled">
                {notes.length}/{MAX_NOTES}
              </span>
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                onClick={() => {
                  setRejectOpen(false);
                  setNotes("");
                  setError(null);
                }}
                disabled={busy !== null}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void reject()}
                disabled={!valid || busy !== null}
                loading={busy === "reject"}
              >
                Submit reject
              </Button>
            </div>
          </div>
          {!valid && notes.length > 0 ? (
            <p className="text-hud-micro text-critical-hot">Review notes are required to reject (T9)</p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-hud-body text-critical-hot">
          {error}
          {isTransitionError(error) ? " — refreshing task state" : ""}
        </p>
      ) : null}
    </div>
  );
}
