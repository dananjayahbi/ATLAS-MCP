"use client";

import { cn } from "@/lib/format/cn";
import type { ChecklistItemDTO } from "@/lib/types/enums";
import { Gauge } from "@/components/ui/gauge";
import { Badge } from "@/components/ui/badge";
import { LeaseChip } from "./lease-chip";

/** Doc 06 §7.2 rows 2–3 — DoD gauge plus the lease countdown. */

export type DodGaugeProps = {
  items: ChecklistItemDTO[];
  percent: number;
  leaseSeconds?: number | null;
  /** `is_overdue` on the DTO — the advisory deadline has passed. */
  isOverdue?: boolean;
  /** `lease_seconds_overdue` on the DTO. */
  leaseSecondsOverdue?: number;
  attempts?: number;
  className?: string;
};

export function DodGauge({
  items,
  percent,
  leaseSeconds = null,
  isOverdue = false,
  leaseSecondsOverdue = 0,
  attempts = 1,
  className,
}: DodGaugeProps) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <Gauge value={percent} items={items} size="md" label="Definition of done" className="min-w-0 flex-1" />
      <LeaseChip
        secondsRemaining={leaseSeconds}
        isOverdue={isOverdue}
        secondsOverdue={leaseSecondsOverdue}
        className="text-hud-micro"
      />
      {attempts > 1 ? <Badge tone="neutral">↻{attempts}</Badge> : null}
    </div>
  );
}
