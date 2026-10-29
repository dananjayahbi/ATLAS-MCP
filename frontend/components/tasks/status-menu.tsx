"use client";

/**
 * The status override menu.
 *
 * Which targets are offered is derived from `MANUAL_TRANSITIONS` so the UI can
 * never present a move the guard table (Doc 01 §8) will refuse — a 409 is a
 * bug here, not a user error.
 */
import { cn } from "@/lib/format/cn";
import { STATUS_META, TASK_STATUS_ORDER } from "@/lib/format/tone";
import type { TaskStatus } from "@/lib/types/enums";

export const MANUAL_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  PENDING_APPROVAL: [],
  PENDING: ["IN_PROGRESS", "REJECTED"],
  IN_PROGRESS: ["PENDING", "IN_REVIEW"],
  IN_REVIEW: ["COMPLETED", "PENDING"],
  // Reopenable: completion can be a misclick, and code reverted by hand in the
  // IDE has to go back in the queue. `IN_PROGRESS` is absent on purpose — only
  // an agent may claim work (a lease transition, not a dropdown choice).
  COMPLETED: ["REJECTED", "PENDING", "IN_REVIEW"],
  REJECTED: ["PENDING"],
};

export const MANUAL_TARGETS: readonly TaskStatus[] = TASK_STATUS_ORDER;

export function statusTargets(from: TaskStatus): readonly TaskStatus[] {
  return MANUAL_TRANSITIONS[from] ?? [];
}

export function canChangeStatus(from: TaskStatus): boolean {
  return statusTargets(from).length > 0;
}

export type StatusMenuProps = {
  status: TaskStatus;
  onChange: (next: TaskStatus) => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
};

export function StatusMenu({ status, onChange, disabled = false, busy = false, className }: StatusMenuProps) {
  const targets = statusTargets(status);
  if (targets.length === 0) {
    return (
      <p className={cn("text-hud-micro uppercase tracking-[0.06em] text-disabled", className)}>
        {STATUS_META[status].label} is terminal
      </p>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <span className="text-hud-micro uppercase tracking-[0.08em] text-secondary">Move to</span>
      {targets.map((target) => (
        <button
          key={target}
          type="button"
          onClick={() => onChange(target)}
          disabled={disabled || busy}
          className={cn(
            "rounded-chip border px-1.5 py-0.5 font-ui text-hud-micro uppercase tracking-[0.06em] transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40",
            STATUS_META[target].className,
            "hover:border-grid-strong",
          )}
        >
          <span aria-hidden className="mr-1">
            {STATUS_META[target].glyph}
          </span>
          {STATUS_META[target].label}
        </button>
      ))}
    </div>
  );
}

/** Why an agent filter exists at all: assignment is a lease, not a dropdown. */
export const ASSIGNMENT_HINT =
  "Agents self-assign by claiming a PENDING task (claim_next_task), which starts a 15-minute lease estimate. " +
  "Heartbeats renew it; a lapsed estimate only flags the task OVERDUE and never returns it to PENDING. " +
  "You can pre-bind a queued task with Claim for agent, or override the assignee while it is not leased.";
