/** Doc 06 §11.5 — scale helpers for the priority matrix (no chart library). */

export const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

export const linear =
  (domain: [number, number], range: [number, number]) =>
  (value: number): number => {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const span = d1 - d0 || 1;
    return r0 + ((clamp(value, d0, d1) - d0) / span) * (r1 - r0);
  };

export const invert =
  (domain: [number, number], range: [number, number]) =>
  (px: number): number => {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const span = r1 - r0 || 1;
    return d0 + ((px - r0) / span) * (d1 - d0);
  };

export function niceMax(raw: number, minSpan: number): number {
  const target = Math.max(raw, minSpan);
  if (!Number.isFinite(target) || target <= 0) return minSpan;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  for (const factor of [1, 1.5, 2, 2.5, 5, 10]) {
    if (target <= factor * magnitude) return factor * magnitude;
  }
  return 10 * magnitude;
}

export type MatrixBox = { top: number; right: number; bottom: number; left: number };
export const MATRIX_MARGIN: MatrixBox = { top: 12, right: 18, bottom: 26, left: 38 };

export function buildScales(width: number, height: number, xMax: number, margin: MatrixBox = MATRIX_MARGIN) {
  const innerW = Math.max(1, width - margin.left - margin.right);
  const innerH = Math.max(1, height - margin.top - margin.bottom);
  return {
    box: { ...margin, innerW, innerH },
    x: linear([0, xMax], [margin.left, margin.left + innerW]),
    // Y range reversed so priority 0 sits at the bottom without a second negation.
    y: linear([0, 100], [margin.top + innerH, margin.top]),
    invX: invert([0, xMax], [margin.left, margin.left + innerW]),
    invY: invert([0, 100], [margin.top + innerH, margin.top]),
  };
}

export type Scales = ReturnType<typeof buildScales>;

/** Evenly spaced tick values across a domain, `count` inclusive of both ends. */
export function ticks(max: number, count: number): number[] {
  if (count < 2) return [0, max];
  return Array.from({ length: count }, (_, index) => (max / (count - 1)) * index);
}

export function radiusFor(dodProgressPercent: number): number {
  return 3 + 5 * (clamp(dodProgressPercent, 0, 100) / 100);
}
