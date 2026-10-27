import type { ReactNode } from "react";
import { cn } from "@/lib/format/cn";
import type { LogLevel, TaskStatus } from "@/lib/types/enums";
import { LOG_LEVEL_META, STATUS_META } from "@/lib/format/tone";
import { PRIORITY_BORDER_CLASS, PRIORITY_LABEL, PRIORITY_TEXT_CLASS, formatPriority, priorityBand } from "@/lib/format/priority";

/** Doc 05 §8.4 — status / log-level badges and the priority chip. */

export type StatusBadgeProps = {
  status: TaskStatus;
  size?: "sm" | "md";
  pulse?: boolean;
  showGlyph?: boolean;
  className?: string;
};

export function StatusBadge({ status, size = "sm", pulse = true, showGlyph = true, className }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span
      data-pulse={pulse && meta.pulse ? "status" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-chip border px-1.5 font-ui uppercase",
        size === "sm" ? "h-4 text-hud-micro" : "h-5 text-hud-label",
        meta.className,
        className,
      )}
    >
      {showGlyph ? <span aria-hidden>{meta.glyph}</span> : null}
      {meta.label}
    </span>
  );
}

export type LogLevelChipProps = {
  level: LogLevel;
  compact?: boolean;
  className?: string;
};

export function LogLevelChip({ level, compact = true, className }: LogLevelChipProps) {
  const meta = LOG_LEVEL_META[level];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-chip font-machine text-hud-micro uppercase tabular-nums",
        compact ? "size-auto min-w-4 justify-center px-1" : "gap-1 px-1.5",
        meta.className,
        className,
      )}
    >
      <span aria-hidden>{meta.glyph}</span>
      {compact ? <span className="sr-only">{level}</span> : level}
    </span>
  );
}

export type PriorityChipProps = {
  priority: number;
  showLabel?: boolean;
  className?: string;
};

export function PriorityChip({ priority, showLabel = false, className }: PriorityChipProps) {
  const band = priorityBand(priority);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-chip border px-1.5 font-machine text-hud-micro uppercase tabular-nums",
        PRIORITY_BORDER_CLASS[band],
        PRIORITY_TEXT_CLASS[band],
        className,
      )}
      title={showLabel ? `Priority ${priority} · ${PRIORITY_LABEL[band]}` : `Priority ${priority}`}
    >
      {formatPriority(priority)}
      {showLabel ? <span className="text-hud-micro opacity-80">{PRIORITY_LABEL[band]}</span> : null}
    </span>
  );
}

export type BadgeProps = {
  children: ReactNode;
  tone?: "neutral" | "flow" | "review" | "success" | "critical";
  className?: string;
  title?: string;
};

const TONES: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "border-grid bg-raised text-secondary",
  flow: "border-flow/30 bg-flow-tint text-flow",
  review: "border-review/40 bg-review-tint text-review-hot",
  success: "border-success/30 bg-success-tint text-success-soft",
  critical: "border-critical/40 bg-critical-tint text-critical-hot",
};

export function Badge({ children, tone = "neutral", className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-chip border px-1.5 font-ui text-hud-micro uppercase tracking-[0.06em]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
