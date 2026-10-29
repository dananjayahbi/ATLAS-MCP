import { cn } from "@/lib/format/cn";
import { formatAgeHours, formatRelativeTime } from "@/lib/format/duration";
import { HEALTH_CLASS, healthTone, STATUS_META } from "@/lib/format/tone";
import type { TelemetrySummaryDTO } from "@/lib/types/api";
import { Badge } from "@/components/ui/badge";
import { Gauge } from "@/components/ui/gauge";

/** Doc 06 §5.1 — telemetry strip: radar header plus per-project health cards. */

export type TelemetryStripProps = {
  telemetry: TelemetrySummaryDTO | undefined;
  className?: string;
};

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="flex min-w-24 flex-col gap-0.5 rounded-hud border border-grid bg-inset/60 px-2 py-1" title={hint}>
      <span className="text-hud-micro uppercase tracking-[0.08em] text-disabled">{label}</span>
      <span className={cn("font-machine text-hud-title tabular-nums", tone ?? "text-primary")}>{value}</span>
    </div>
  );
}

export function TelemetryStrip({ telemetry, className }: TelemetryStripProps) {
  if (!telemetry) {
    return (
      <div className={cn("flex items-center gap-2 text-hud-body text-muted", className)}>
        <Badge tone="review">TELEMETRY UNAVAILABLE</Badge>
        <span>The orchestration engine has not reported yet.</span>
      </div>
    );
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(telemetry.generated_at)) / 1000));
  const stale = ageSeconds > 60;

  return (
    <div className={cn("flex min-h-0 flex-wrap items-stretch gap-1.5", className)}>
      <Metric
        label="Discoveries"
        value={String(telemetry.discoveries_pending)}
        tone={telemetry.discoveries_pending > 0 ? "text-review-hot" : "text-primary"}
        hint="PENDING_APPROVAL tasks across all projects"
      />
      <Metric
        label="Oldest pending"
        value={formatAgeHours(telemetry.oldest_pending_age_hours)}
        hint="Age of the oldest PENDING task"
      />
      <Metric
        label="Leases ≤5m"
        value={String(telemetry.leases_expiring_within_5m)}
        tone={telemetry.leases_expiring_within_5m > 0 ? "text-critical-hot" : "text-primary"}
        hint="Agent lease estimates elapsing within five minutes (advisory)"
      />
      <Metric
        label="Leases overdue"
        value={String(telemetry.leases_overdue)}
        tone={telemetry.leases_overdue > 0 ? "text-critical-hot" : "text-primary"}
        hint="IN_PROGRESS tasks past their agent's estimate — still owned, just flagged"
      />
      <Metric
        label="Throughput 24h"
        value={String(telemetry.throughput_last_24h)}
        tone="text-success-soft"
        hint="Completions in the last 24 hours"
      />
      <Metric
        label="Telemetry"
        value={stale ? `STALE ${Math.floor(ageSeconds / 60)}m` : "LIVE"}
        tone={stale ? "text-review" : "text-success-soft"}
        hint={`Generated ${formatRelativeTime(telemetry.generated_at)}`}
      />

      <div className="flex min-w-0 flex-1 flex-wrap items-stretch gap-1.5">
        {telemetry.projects.map((project) => (
          <div
            key={project.slug}
            className="flex min-w-40 flex-1 flex-col gap-1 rounded-hud border border-grid bg-panel/70 px-2 py-1"
          >
            <div className="flex items-baseline gap-1.5">
              <span className="font-machine text-hud-label uppercase tracking-[0.08em] text-flow">{project.slug}</span>
              <span
                className={cn(
                  "ml-auto font-machine text-machine-sm tabular-nums",
                  HEALTH_CLASS[healthTone(project.health_percent)],
                )}
              >
                {project.health_percent}%
              </span>
            </div>
            <Gauge
              value={project.health_percent}
              size="sm"
              showLabel={false}
              tone="health"
              label={`${project.slug} health`}
            />
            <span
              className="truncate font-machine text-hud-micro text-muted"
              title={project.active_agent_id ?? "no active agent"}
            >
              {project.active_agent_id ?? "—"} · {project.in_progress} running
            </span>
          </div>
        ))}
      </div>
      <span className="sr-only">{STATUS_META.IN_PROGRESS.label} indicates a live agent lease.</span>
    </div>
  );
}
