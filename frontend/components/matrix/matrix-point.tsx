"use client";

import { memo } from "react";
import { STATUS_META } from "@/lib/format/tone";
import type { PriorityMatrixPointDTO } from "@/lib/types/api";
import { radiusFor } from "./scale";

/** Doc 06 §11.3 — one plotted point. Memoised on the visual channels only (§15.2). */

export type MatrixPointProps = {
  point: PriorityMatrixPointDTO;
  x: number;
  y: number;
  pinned?: boolean;
  focused: boolean;
  selected: boolean;
  onHover: (point: PriorityMatrixPointDTO | null) => void;
  onFocus: (point: PriorityMatrixPointDTO) => void;
  onSelect: (point: PriorityMatrixPointDTO, additive: boolean) => void;
};

function MatrixPointImpl({
  point,
  x,
  y,
  pinned = false,
  focused,
  selected,
  onHover,
  onFocus,
  onSelect,
}: MatrixPointProps) {
  const r = radiusFor(point.dod_progress_percent);
  const color = STATUS_META[point.status].cssVar;
  const dimmed = point.status === "COMPLETED";

  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={`${point.title} — ${STATUS_META[point.status].label}, priority ${point.priority}, ${point.dod_progress_percent}% DoD${point.is_blocked ? ", blocked" : ""}`}
      aria-pressed={selected}
      onMouseEnter={() => onHover(point)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => {
        onFocus(point);
        onHover(point);
      }}
      onBlur={() => onHover(null)}
      onClick={(event) => onSelect(point, event.shiftKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(point, event.shiftKey);
        }
      }}
      className="cursor-pointer outline-none"
    >
      {point.is_blocked ? (
        <circle cx={x} cy={y} r={r + 2.5} fill="none" stroke="var(--color-critical)" strokeWidth={1.5} />
      ) : null}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={color}
        fillOpacity={dimmed ? 0.45 : 0.85}
        stroke={point.is_agent_discovered ? "var(--color-flow)" : "var(--color-canvas)"}
        strokeWidth={point.is_agent_discovered ? 1 : 0.75}
        strokeDasharray={point.is_agent_discovered ? "2 1.5" : undefined}
      />
      {selected ? <circle cx={x} cy={y} r={r + 4} fill="none" stroke="var(--color-flow)" strokeWidth={1} /> : null}
      {focused ? <circle cx={x} cy={y} r={r + 5.5} fill="none" stroke="var(--color-primary)" strokeWidth={1} /> : null}
      {pinned ? <text x={x + r + 2} y={y + 3} fontSize={9} fill="var(--color-secondary)">▸</text> : null}
    </g>
  );
}

export const MatrixPoint = memo(
  MatrixPointImpl,
  (a, b) =>
    a.x === b.x &&
    a.y === b.y &&
    a.focused === b.focused &&
    a.selected === b.selected &&
    a.pinned === b.pinned &&
    a.point.status === b.point.status &&
    a.point.is_blocked === b.point.is_blocked &&
    a.point.is_agent_discovered === b.point.is_agent_discovered &&
    a.point.dod_progress_percent === b.point.dod_progress_percent,
);
