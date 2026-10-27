import { cn } from "@/lib/format/cn";
import { ticks, type Scales } from "./scale";

/** Doc 06 §11.4 — grid, ticks and axis labels. Memoised on `[xMax, innerW, innerH]`. */

export type MatrixAxesProps = {
  scales: Scales;
  xMax: number;
  xLabel: string;
  xFormat: (value: number) => string;
  width: number;
  height: number;
  className?: string;
};

const PRIORITY_TICKS = [0, 25, 50, 75, 100];

export function MatrixAxes({ scales, xMax, xLabel, xFormat, width, height, className }: MatrixAxesProps) {
  const { box, x, y } = scales;
  const left = box.left;
  const right = box.left + box.innerW;
  const top = box.top;
  const bottom = box.top + box.innerH;

  return (
    <g aria-hidden className={cn("text-muted", className)}>
      {PRIORITY_TICKS.map((value) => (
        <g key={`y-${value}`}>
          <line
            x1={left}
            x2={right}
            y1={y(value)}
            y2={y(value)}
            stroke="var(--border-grid)"
            strokeWidth={0.75}
            strokeDasharray={value === 0 ? undefined : "2 3"}
          />
          <text x={left - 6} y={y(value) + 3} textAnchor="end" fontSize={9} fill="var(--text-muted)">
            {value}
          </text>
        </g>
      ))}

      {ticks(xMax, 5).map((value, index) => (
        <g key={`x-${index}`}>
          <line x1={x(value)} x2={x(value)} y1={top} y2={bottom} stroke="var(--border-grid)" strokeWidth={0.5} opacity={0.5} />
          <text x={x(value)} y={bottom + 11} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
            {xFormat(value)}
          </text>
        </g>
      ))}

      <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="var(--border-strong)" strokeWidth={1} />
      <line x1={left} x2={left} y1={top} y2={bottom} stroke="var(--border-strong)" strokeWidth={1} />

      <text x={right} y={height - 2} textAnchor="end" fontSize={9} fill="var(--text-secondary)">
        x = {xLabel} →
      </text>
      <text x={4} y={top + 6} fontSize={9} fill="var(--text-secondary)" transform={`rotate(-90 8 ${top + 30})`}>
        y = priority ↑
      </text>

      <text x={width - 2} y={2} textAnchor="end" fontSize={8} fill="var(--text-disabled)">
        {xMax}
      </text>
    </g>
  );
}
