"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/format/cn";
import { formatAgeHours } from "@/lib/format/duration";
import { STATUS_META, TASK_STATUS_ORDER } from "@/lib/format/tone";
import type { PriorityMatrixPointDTO, PriorityMatrixResponse } from "@/lib/types/api";
import type { MatrixXAxis } from "@/lib/api/telemetry";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { MatrixAxes } from "./matrix-axes";
import { MatrixPoint } from "./matrix-point";
import { MatrixTooltip } from "./matrix-tooltip";
import { buildScales, clamp, niceMax, radiusFor } from "./scale";

/**
 * Doc 06 §11 — custom SVG scatter. Budget ≤ 20 kB; no chart library, no raw hex.
 * Canvas-owned: this component never traps focus (points are tab-stops, `Esc` blurs).
 */

export type PriorityMatrixProps = {
  data: PriorityMatrixResponse | undefined;
  loading?: boolean;
  xAxis: MatrixXAxis;
  onXAxisChange: (axis: MatrixXAxis) => void;
  selection: ReadonlySet<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onOpenTask?: (taskId: string) => void;
  height?: number;
  className?: string;
};

const MIN_SPAN: Record<MatrixXAxis, number> = { age_hours: 12, dependency_weight: 2 };
const ZOOM_STEPS = [0.5, 1, 2, 3, 4];

export function PriorityMatrix({
  data,
  loading = false,
  xAxis,
  onXAxisChange,
  selection,
  onSelectionChange,
  onOpenTask,
  height = 260,
  className,
}: PriorityMatrixProps) {
  const [bodyWidth, setBodyWidth] = useState(560);
  const [zoomIndex, setZoomIndex] = useState(1);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<PriorityMatrixPointDTO | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setBodyWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setZoomIndex(1), [xAxis]);

  const points = data?.points ?? [];
  const rawMax =
    xAxis === "age_hours"
      ? points.reduce((max, point) => Math.max(max, point.age_hours), 0)
      : points.reduce((max, point) => Math.max(max, point.dependency_weight), 0);
  const baseMax = niceMax(rawMax, MIN_SPAN[xAxis]);
  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  const xMax = baseMax / zoom;

  const scales = useMemo(() => buildScales(bodyWidth, height, xMax), [bodyWidth, height, xMax]);

  const toggleAxis = useCallback(() => {
    onXAxisChange(xAxis === "age_hours" ? "dependency_weight" : "age_hours");
  }, [onXAxisChange, xAxis]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "x" || event.key === "X") {
        event.preventDefault();
        toggleAxis();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoomIndex((value) => Math.min(ZOOM_STEPS.length - 1, value + 1));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoomIndex((value) => Math.max(0, value - 1));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoomIndex(1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggleAxis]);

  const handleSelect = useCallback(
    (point: PriorityMatrixPointDTO, additive: boolean) => {
      setFocusedId(point.task_id);
      if (!additive) {
        onSelectionChange(new Set([point.task_id]));
        onOpenTask?.(point.task_id);
        return;
      }
      const next = new Set(selection);
      if (next.has(point.task_id)) next.delete(point.task_id);
      else next.add(point.task_id);
      onSelectionChange(next);
    },
    [onOpenTask, onSelectionChange, selection],
  );

  const xFormat = useMemo(
    () => (xAxis === "age_hours" ? (value: number) => `${Math.round(value)}h` : (value: number) => String(Math.round(value))),
    [xAxis],
  );

  return (
    <div ref={wrapRef} className={cn("flex min-h-0 min-w-0 flex-col gap-2", className)}>
      <div className="flex shrink-0 items-center gap-2">
        <Tabs
          items={[
            { id: "age_hours", label: "Age" },
            { id: "dependency_weight", label: "Deps" },
          ]}
          value={xAxis}
          onChange={(id) => onXAxisChange(id as MatrixXAxis)}
        />
        <span className="font-machine text-hud-micro tabular-nums text-muted">
          {points.length} pts · {zoom}×
        </span>
        {selection.size > 0 ? (
          <span className="rounded-chip border border-flow/40 bg-flow-tint px-1.5 font-machine text-hud-micro tabular-nums text-flow">
            {selection.size} selected
          </span>
        ) : null}
        <span className="min-w-0 flex-1" />
        <span className="font-machine text-hud-micro text-disabled" title="Keyboard: X axis, +/- zoom, 0 reset">
          X · +/− · 0
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {loading && points.length === 0 ? (
          <Skeleton lines={4} />
        ) : points.length === 0 ? (
          <EmptyState inline title="No tasks to plot" hint="Create a task (C) or clear the filters." />
        ) : (
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${bodyWidth} ${height}`}
            role="group"
            aria-label={`Priority matrix, x axis ${xAxis === "age_hours" ? "age in hours" : "dependency weight"}`}
            className="block"
          >
            <MatrixAxes
              scales={scales}
              xMax={xMax}
              xLabel={xAxis === "age_hours" ? "age_hours" : "dependency_weight"}
              xFormat={xFormat}
              width={bodyWidth}
              height={height}
            />
            {points.map((point) => {
              const rawX = xAxis === "age_hours" ? point.age_hours : point.dependency_weight;
              const pinned = rawX > xMax;
              return (
                <MatrixPoint
                  key={point.task_id}
                  point={point}
                  x={scales.x(clamp(rawX, 0, xMax))}
                  y={scales.y(clamp(point.priority, 0, 100))}
                  pinned={pinned}
                  focused={focusedId === point.task_id}
                  selected={selection.has(point.task_id)}
                  onHover={setHovered}
                  onFocus={(p) => setFocusedId(p.task_id)}
                  onSelect={handleSelect}
                />
              );
            })}
            {hovered ? (
              <MatrixTooltip
                point={hovered}
                x={clamp(scales.x(xAxis === "age_hours" ? hovered.age_hours : hovered.dependency_weight), 90, bodyWidth - 90)}
                y={Math.max(60, scales.y(hovered.priority) - radiusFor(hovered.dod_progress_percent) - 6)}
              />
            ) : null}
          </svg>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-hud-micro uppercase tracking-[0.06em] text-muted">
        {TASK_STATUS_ORDER.map((status) => (
          <span key={status} className="inline-flex items-center gap-1">
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: STATUS_META[status].cssVar }} />
            {STATUS_META[status].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full border border-critical" />
          blocked
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="size-2 rounded-full border border-dashed border-flow" />
          discovered
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <span aria-hidden>◍</span>size = DoD
        </span>
        {xAxis === "age_hours" ? <span className="text-disabled">max {formatAgeHours(baseMax)}</span> : null}
      </div>
    </div>
  );
}
