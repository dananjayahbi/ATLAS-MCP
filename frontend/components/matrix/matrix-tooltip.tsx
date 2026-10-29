import { cn } from "@/lib/format/cn";
import { STATUS_META } from "@/lib/format/tone";
import { formatAgeHours } from "@/lib/format/duration";
import { PRIORITY_LABEL, priorityBand } from "@/lib/format/priority";
import type { PriorityMatrixPointDTO } from "@/lib/types/api";
import { Badge } from "@/components/ui/badge";

/** Doc 06 §11.6 — tooltip: all seven DTO fields, no invented data. */

export type MatrixTooltipProps = {
  point: PriorityMatrixPointDTO;
  x: number;
  y: number;
  className?: string;
};

export function MatrixTooltip({ point, x, y, className }: MatrixTooltipProps) {
  return (
    <div
      role="tooltip"
      style={{ left: x, top: y }}
      className={cn(
        "pointer-events-none absolute z-30 w-60 -translate-x-1/2 -translate-y-full rounded-hud border border-grid-strong bg-raised/98 p-2 text-hud-body shadow-hud-panel",
        className,
      )}
    >
      <p className="mb-1 min-w-0 truncate text-hud-bodylg font-medium text-primary" title={point.title}>
        {point.title}
      </p>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-machine text-machine-sm tabular-nums">
        <dt className="text-muted">project</dt>
        <dd className="text-right text-secondary">{point.project_slug}</dd>
        <dt className="text-muted">status</dt>
        <dd className="text-right" style={{ color: STATUS_META[point.status].cssVar }}>
          {STATUS_META[point.status].label}
        </dd>
        <dt className="text-muted">priority</dt>
        <dd className="text-right text-primary">
          {point.priority} · {PRIORITY_LABEL[priorityBand(point.priority)]}
        </dd>
        <dt className="text-muted">DoD</dt>
        <dd className="text-right text-secondary">{point.dod_progress_percent}%</dd>
        <dt className="text-muted">age</dt>
        <dd className="text-right text-secondary">{formatAgeHours(point.age_hours)}</dd>
        <dt className="text-muted">dep</dt>
        <dd className="text-right text-secondary">{point.dependency_weight}</dd>
      </dl>
      <div className="mt-1 flex flex-wrap gap-1">
        {point.is_blocked ? (
          <Badge tone="review" title="Blocked — a blocker's Definition of Done is below 100%">
            ⛔ BLOCKED
          </Badge>
        ) : null}
        {point.is_agent_discovered ? <Badge tone="review">⚡ DISCOVERED</Badge> : null}
      </div>
    </div>
  );
}
