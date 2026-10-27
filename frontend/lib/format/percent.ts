/** Doc 06 §1.1 — percentage helpers. Values arrive pre-rounded from the API (Doc 01 §6.9). */

export function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

export function clampPercent(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

/** `76%`; `showDecimals` only for sub-percent engineering readouts. */
export function formatPercent(value: number, showDecimals = false): string {
  const v = clamp(value, 0, 100);
  return `${showDecimals ? v.toFixed(1) : Math.round(v)}%`;
}

/** `2/3` for checklist gauges. */
export function formatRatio(done: number, total: number): string {
  return `${Math.max(0, Math.floor(done))}/${Math.max(0, Math.floor(total))}`;
}

export type ProgressTone = "empty" | "partial" | "complete";

export function progressTone(percent: number): ProgressTone {
  const v = clamp(percent, 0, 100);
  if (v >= 100) return "complete";
  if (v <= 0) return "empty";
  return "partial";
}

/** Tailwind token classes for a progress value (Doc 05 §7.4). */
export function progressClass(percent: number): string {
  switch (progressTone(percent)) {
    case "complete":
      return "bg-success";
    case "empty":
      return "bg-inset";
    default:
      return "bg-flow";
  }
}
