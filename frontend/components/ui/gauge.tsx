import { cn } from "@/lib/format/cn";
import { clampPercent } from "@/lib/format/percent";
import { DOD_CLASS, dodTone } from "@/lib/format/tone";
import type { ChecklistItemDTO } from "@/lib/types/enums";

/** Doc 05 §8.3 — DoD gauge. LED blocks (`segments`) or one block per checklist item. */

export type GaugeProps = {
  value: number;
  segments?: number;
  items?: ChecklistItemDTO[];
  size?: "sm" | "md";
  showLabel?: boolean;
  tone?: "auto" | "flow" | "success" | "health";
  label?: string;
  className?: string;
};

export function Gauge({
  value,
  segments = 10,
  items,
  size = "md",
  showLabel = true,
  tone = "auto",
  label = "Definition of done",
  className,
}: GaugeProps) {
  const total = items && items.length > 0 ? items.length : segments;
  const done = items && items.length > 0
    ? items.filter((item) => item.completed).length
    : Math.round((clampPercent(value) / 100) * segments);
  const percent = clampPercent(value);

  const fillClass =
    tone === "health"
      ? percent >= 75
        ? "bg-success"
        : percent >= 40
          ? "bg-review"
          : "bg-critical"
      : tone === "success" || (tone === "auto" && percent >= 67)
        ? "bg-success"
        : tone === "flow"
          ? "bg-flow"
          : "bg-flow";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={
          items && items.length > 0 ? `${done} of ${total} checklist items complete` : `${percent} percent complete`
        }
        className={cn("flex min-w-0 flex-1 gap-[2px]", size === "sm" ? "h-1" : "h-2")}
      >
        {Array.from({ length: total }).map((_, index) => (
          <span
            key={items?.[index]?.id ?? index}
            title={items?.[index] ? `#${items[index].id} ${items[index].label}` : undefined}
            className={cn(
              "min-w-0 flex-1 rounded-chip transition-colors duration-100",
              index < done ? fillClass : "bg-inset ring-1 ring-inset ring-grid",
            )}
          />
        ))}
      </div>
      {showLabel ? (
        <span className={cn("w-10 shrink-0 text-right font-machine text-machine-sm tabular-nums", DOD_CLASS[dodTone(percent)])}>
          {items && items.length > 0 ? `${done}/${total}` : `${percent}%`}
        </span>
      ) : null}
    </div>
  );
}

/** Doc 05 alias. */
export const SegmentedGauge = Gauge;

export type RadialGaugeProps = {
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
};

/** Radial variant used in the task detail header (Doc 06 deliverable 4). */
export function RadialGauge({ value, size = 88, strokeWidth = 6, label = "Definition of done", className }: RadialGaugeProps) {
  const percent = clampPercent(value);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (percent / 100) * circumference;
  const colorVar = percent >= 100 ? "var(--status-completed)" : percent >= 67 ? "var(--status-completed)" : "var(--status-in-progress)";
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${percent} percent complete`}
        className="-rotate-90"
      >
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-grid)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colorVar}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          style={{ transition: "stroke-dasharray 420ms var(--ease-hud)" }}
        />
      </svg>
      <span className="absolute font-machine text-hud-title tabular-nums text-primary">{percent}%</span>
    </div>
  );
}
