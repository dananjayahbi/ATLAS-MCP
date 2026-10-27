/** Doc 05 §7.3 — the single source of priority band logic. */

export type PriorityBand = "low" | "medium" | "high" | "critical";

export function priorityBand(priority: number): PriorityBand {
  const p = Number.isFinite(priority) ? priority : 0;
  if (p >= 90) return "critical";
  if (p >= 70) return "high";
  if (p >= 40) return "medium";
  return "low";
}

export const PRIORITY_LABEL: Record<PriorityBand, string> = {
  low: "LOW",
  medium: "MED",
  high: "HIGH",
  critical: "CRITICAL",
};

/** Bar fill class per band. Only these four names exist (Doc 05 §7.3). */
export const PRIORITY_BAR_CLASS: Record<PriorityBand, string> = {
  low: "bg-priority-low",
  medium: "bg-flow-dim",
  high: "bg-review",
  critical: "bg-critical-hot",
};

/** Text class per band — used by `PriorityChip`. */
export const PRIORITY_TEXT_CLASS: Record<PriorityBand, string> = {
  low: "text-priority-low",
  medium: "text-flow-dim",
  high: "text-review",
  critical: "text-critical-hot",
};

export const PRIORITY_BORDER_CLASS: Record<PriorityBand, string> = {
  low: "border-priority-low/40",
  medium: "border-flow-dim/40",
  high: "border-review/40",
  critical: "border-critical-hot/50",
};

/** Priority bands used by the board when `group=priority` (Doc 06 §8.4). */
export type PriorityGroup = { id: string; label: string; min: number; max: number };

export const PRIORITY_GROUPS: readonly PriorityGroup[] = [
  { id: "p90", label: "P90-100", min: 90, max: 100 },
  { id: "p75", label: "P75-89", min: 75, max: 89 },
  { id: "p50", label: "P50-74", min: 50, max: 74 },
  { id: "p25", label: "P25-49", min: 25, max: 49 },
  { id: "p0", label: "P0-24", min: 0, max: 24 },
];

export function priorityGroupOf(priority: number): string {
  const hit = PRIORITY_GROUPS.find((g) => priority >= g.min && priority <= g.max);
  return hit?.id ?? "p0";
}

/** `P95` — numeric priority chip text. */
export function formatPriority(priority: number): string {
  return `P${Math.round(priority)}`;
}

export function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
