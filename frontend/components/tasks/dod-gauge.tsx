"use client";

import { cn } from "@/lib/format/cn";
import { formatCountdown } from "@/lib/format/duration";
import { LEASE_CLASS, leaseTone } from "@/lib/format/tone";
import type { ChecklistItemDTO } from "@/lib/types/enums";
import { Gauge } from "@/components/ui/gauge";
import { Badge } from "@/components/ui/badge";

/** Doc 06 §7.2 rows 2–3 — DoD gauge plus the lease countdown. */

export type DodGaugeProps = {
  items: ChecklistItemDTO[];
  percent: number;
  leaseSeconds?: number | null;
  attempts?: number;
  className?: string;
};

export function DodGauge({ items, percent, leaseSeconds = null, attempts = 1, className }: DodGaugeProps) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <Gauge value={percent} items={items} size="md" label="Definition of done" className="min-w-0 flex-1" />
      <span
        className={cn("shrink-0 font-machine text-hud-micro tabular-nums", LEASE_CLASS[leaseTone(leaseSeconds)])}
        title={leaseSeconds === null ? "No active lease" : `Lease ${formatCountdown(leaseSeconds)} remaining`}
      >
        ⏱ {formatCountdown(leaseSeconds)}
      </span>
      {attempts > 1 ? <Badge tone="neutral">↻{attempts}</Badge> : null}
    </div>
  );
}
