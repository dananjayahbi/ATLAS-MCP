import Link from "next/link";
import { cn } from "@/lib/format/cn";
import { formatAgeHours } from "@/lib/format/duration";
import type { TelemetrySummaryDTO } from "@/lib/types/api";
import { STATUS_META, TASK_STATUS_ORDER } from "@/lib/format/tone";

/** Doc 06 §5.1 row 2 preview — global counters under the bar (server-safe). */

export type StatusRailProps = {
  telemetry: TelemetrySummaryDTO | null;
  className?: string;
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1">
      <span className="text-hud-micro uppercase tracking-[0.08em] text-muted">{label}</span>
      <span className={cn("font-machine text-machine-sm tabular-nums", tone ?? "text-primary")}>{value}</span>
    </span>
  );
}

export function StatusRail({ telemetry, className }: StatusRailProps) {
  if (!telemetry) {
    return (
      <div className={cn("flex h-7 items-center gap-3 px-3 text-hud-micro uppercase text-disabled", className)}>
        <span>Telemetry unavailable</span>
      </div>
    );
  }

  return (
    <div className={cn("flex h-7 items-center gap-3 overflow-x-auto px-3", className)} aria-label="Global status rail">
      {TASK_STATUS_ORDER.map((status) => {
        const count = telemetry.tasks_by_status[status] ?? 0;
        if (count === 0) return null;
        return (
          <span key={status} className="inline-flex shrink-0 items-baseline gap-1" title={STATUS_META[status].label}>
            <span aria-hidden className="translate-y-px" style={{ color: STATUS_META[status].cssVar }}>
              {STATUS_META[status].glyph}
            </span>
            <span className="font-machine text-machine-sm tabular-nums text-secondary">{count}</span>
            <span className="text-hud-micro uppercase tracking-[0.06em] text-disabled">
              {STATUS_META[status].label.split(" ")[0]}
            </span>
          </span>
        );
      })}

      <span aria-hidden className="h-3 w-px shrink-0 bg-grid" />

      <Link href="/discoveries" className="shrink-0 hover:underline">
        <Stat label="Discoveries" value={String(telemetry.discoveries_pending)} tone="text-review-hot" />
      </Link>
      <Stat label="Oldest" value={formatAgeHours(telemetry.oldest_pending_age_hours)} />
      <Stat
        label="Leases ≤5m"
        value={String(telemetry.leases_expiring_within_5m)}
        tone={telemetry.leases_expiring_within_5m > 0 ? "text-critical-hot" : "text-primary"}
      />
      <Stat label="24h" value={String(telemetry.throughput_last_24h)} tone="text-success-soft" />

      <span className="min-w-0 flex-1" />

      <span className="hidden shrink-0 items-center gap-1 lg:inline-flex">
        <span className="text-hud-micro uppercase tracking-[0.08em] text-muted">Projects</span>
        {telemetry.projects.map((project) => (
          <Link
            key={project.slug}
            href={`/projects/${project.slug}`}
            className="rounded-chip border border-grid px-1.5 font-machine text-hud-micro text-secondary hover:border-grid-strong hover:text-primary"
            title={`${project.slug} · health ${project.health_percent}% · agent ${project.active_agent_id ?? "—"}`}
          >
            {project.slug}
            <span className="ml-1 tabular-nums text-muted">{project.health_percent}%</span>
          </Link>
        ))}
      </span>
    </div>
  );
}
