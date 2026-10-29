import { cn } from "@/lib/format/cn";
import { formatCountdown, formatDuration, formatOverdue } from "@/lib/format/duration";
import { LEASE_CLASS, OVERDUE_CLASS, leaseTone, overdueTone } from "@/lib/format/tone";

/**
 * Doc 06 §7.2 / §8.1 — one lease chip for the board card, the agent pane and the
 * task meta rail.
 *
 * The 900 s lease is an advisory deadline: when it passes the task stays
 * IN_PROGRESS and owned by its agent, so the chip flags OVERDUE in words (not
 * colour alone) while the countdown keeps rendering for healthy leases.
 */

export type LeaseChipProps = {
  /** `lease_seconds_remaining` from the DTO. */
  secondsRemaining: number | null;
  /** `is_overdue` from the DTO. */
  isOverdue?: boolean;
  /** `lease_seconds_overdue` from the DTO. */
  secondsOverdue?: number;
  /** Idle leases render nothing instead of an em dash (compact surfaces). */
  hideWhenIdle?: boolean;
  className?: string;
};

export function LeaseChip({
  secondsRemaining,
  isOverdue = false,
  secondsOverdue = 0,
  hideWhenIdle = false,
  className,
}: LeaseChipProps) {
  if (isOverdue) {
    const elapsed = formatOverdue(secondsOverdue);
    const label =
      elapsed === "—"
        ? "Lease overdue — past the agent's estimate. The task stays with its agent."
        : `Lease ${elapsed} the agent's estimate. The task stays with its agent.`;
    return (
      <span
        aria-label={label}
        title={label}
        data-overdue="true"
        className={cn(
          "inline-flex shrink-0 items-center gap-1 font-machine tabular-nums",
          OVERDUE_CLASS[overdueTone(true)],
          className,
        )}
      >
        <span aria-hidden>⏱</span>OVERDUE
      </span>
    );
  }

  if (secondsRemaining === null && hideWhenIdle) return null;

  const label =
    secondsRemaining === null
      ? "No active lease"
      : `Lease ${formatDuration(secondsRemaining)} remaining (advisory estimate)`;

  return (
    <span
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-machine tabular-nums",
        LEASE_CLASS[leaseTone(secondsRemaining)],
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden>
        ⏱ {formatCountdown(secondsRemaining)}
      </span>
    </span>
  );
}
