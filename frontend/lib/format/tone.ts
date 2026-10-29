import type { LogLevel, TaskStatus } from "@/lib/types/enums";

/** Doc 05 §7.1 — badge labels are verbatim; Doc 06 must not invent abbreviations. */
export type StatusMeta = {
  label: string;
  glyph: string;
  className: string;
  pulse: boolean;
  /** Raw CSS custom property for SVG fills (Doc 06 §1.2 decision: zero hex literals). */
  cssVar: string;
};

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  PENDING_APPROVAL: {
    label: "PENDING APPROVAL",
    glyph: "⚡",
    className: "bg-review-tint border-review/40 text-review-hot",
    pulse: true,
    cssVar: "var(--status-pending-approval)",
  },
  PENDING: {
    label: "PENDING",
    glyph: "◌",
    className: "bg-raised border-grid text-secondary",
    pulse: false,
    cssVar: "var(--status-pending)",
  },
  IN_PROGRESS: {
    label: "IN PROGRESS",
    glyph: "▶",
    className: "bg-flow-tint border-flow/30 text-flow",
    pulse: true,
    cssVar: "var(--status-in-progress)",
  },
  IN_REVIEW: {
    label: "IN REVIEW",
    glyph: "◑",
    className: "bg-review-tint border-review/40 text-review-hot",
    pulse: false,
    cssVar: "var(--status-in-review)",
  },
  COMPLETED: {
    label: "COMPLETED",
    glyph: "✔",
    className: "bg-success-tint border-success/30 text-success-soft",
    pulse: false,
    cssVar: "var(--status-completed)",
  },
  REJECTED: {
    label: "REJECTED",
    glyph: "✕",
    className: "bg-critical-tint border-critical/40 text-critical-hot",
    pulse: false,
    cssVar: "var(--status-rejected)",
  },
};

/** Doc 01 §6.2 order — board columns and status chips follow this, never alphabetical. */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  "PENDING_APPROVAL",
  "PENDING",
  "IN_PROGRESS",
  "IN_REVIEW",
  "COMPLETED",
  "REJECTED",
];

export const STATUS_ORDINAL: Record<TaskStatus, number> = {
  PENDING_APPROVAL: 0,
  PENDING: 1,
  IN_PROGRESS: 2,
  IN_REVIEW: 3,
  COMPLETED: 4,
  REJECTED: 5,
};

export type LogLevelMeta = { glyph: string; className: string; rowClassName: string; weight: string };

export const LOG_LEVEL_META: Record<LogLevel, LogLevelMeta> = {
  DEBUG: { glyph: "··", className: "text-log-debug", rowClassName: "", weight: "font-normal" },
  INFO: { glyph: "›", className: "text-log-info", rowClassName: "", weight: "font-normal" },
  WARN: {
    glyph: "▲",
    className: "text-log-warn bg-review-tint",
    rowClassName: "bg-review/5",
    weight: "font-medium",
  },
  ERROR: {
    glyph: "✖",
    className: "text-log-error bg-critical-tint",
    rowClassName: "bg-critical/8",
    weight: "font-medium",
  },
};

/** Doc 05 §7.4 — `health_percent` bands. */
export type HealthTone = "critical" | "review" | "success";

export function healthTone(percent: number): HealthTone {
  if (percent < 40) return "critical";
  if (percent < 75) return "review";
  return "success";
}

export const HEALTH_CLASS: Record<HealthTone, string> = {
  critical: "text-critical-hot",
  review: "text-review",
  success: "text-success-soft",
};

export const HEALTH_FILL_CLASS: Record<HealthTone, string> = {
  critical: "bg-critical",
  review: "bg-review",
  success: "bg-success",
};

/** Doc 05 §7.4 — `lease_seconds_remaining` bands. */
export type LeaseTone = "safe" | "warning" | "critical";

export function leaseTone(secondsRemaining: number | null): LeaseTone {
  if (secondsRemaining === null) return "safe";
  if (secondsRemaining <= 60) return "critical";
  if (secondsRemaining <= 300) return "warning";
  return "safe";
}

export const LEASE_CLASS: Record<LeaseTone, string> = {
  safe: "text-machine",
  warning: "text-review",
  critical: "text-critical-hot",
};

/**
 * Doc 05 §7.4 — `is_overdue` is advisory: the agent keeps the task, so the
 * chip is hot without the countdown being taken away.
 */
export type OverdueTone = "overdue" | "none";

export function overdueTone(isOverdue: boolean): OverdueTone {
  return isOverdue ? "overdue" : "none";
}

export const OVERDUE_CLASS: Record<OverdueTone, string> = {
  overdue: "text-critical-hot",
  none: "text-machine",
};

/** Doc 05 §7.4 — `dod_progress_percent` bands. */
export function dodTone(percent: number): "secondary" | "flow" | "success" {
  if (percent >= 67) return "success";
  if (percent >= 34) return "flow";
  return "secondary";
}

export const DOD_CLASS: Record<"secondary" | "flow" | "success", string> = {
  secondary: "text-secondary",
  flow: "text-flow",
  success: "text-success-soft",
};
