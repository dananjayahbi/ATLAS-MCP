"use client";

import { cn } from "@/lib/format/cn";
import { MARKUP_COLORS, MARKUP_WIDTHS } from "@/lib/markup/types";
import type { MarkupTool } from "@/lib/markup/types";
import { Kbd } from "@/components/ui/kbd";

/** Pen/eraser, colour, weight, undo/redo, zoom — the markup rail. */

export type MarkupToolbarProps = {
  tool: MarkupTool;
  onTool: (tool: MarkupTool) => void;
  color: string;
  onColor: (color: string) => void;
  width: number;
  onWidth: (width: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  strokeCount: number;
  onClear: () => void;
  disabled?: boolean;
};

function RailButton({
  label,
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-chip border px-1.5 font-machine text-hud-micro uppercase tracking-[0.06em] transition-colors duration-100",
        active
          ? "border-flow/50 bg-flow-tint text-flow"
          : "border-grid text-secondary hover:border-grid-strong hover:text-primary",
        disabled && "cursor-not-allowed opacity-40 hover:border-grid hover:text-secondary",
      )}
    >
      {children}
    </button>
  );
}

export function MarkupToolbar({
  tool,
  onTool,
  color,
  onColor,
  width,
  onWidth,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onResetView,
  strokeCount,
  onClear,
  disabled = false,
}: MarkupToolbarProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-grid bg-panel/80 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <RailButton
          label="Pen tool"
          active={tool === "pen"}
          onClick={() => onTool("pen")}
          disabled={disabled}
          title="Pen (P)"
        >
          <span aria-hidden>✎</span> Pen
        </RailButton>
        <RailButton
          label="Eraser tool"
          active={tool === "eraser"}
          onClick={() => onTool("eraser")}
          disabled={disabled}
          title="Eraser (E)"
        >
          <span aria-hidden>⌫</span> Erase
        </RailButton>

        <span aria-hidden className="mx-1 h-4 w-px bg-grid" />

        <div role="group" aria-label="Ink colour" className="flex items-center gap-1">
          {MARKUP_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Colour ${swatch}`}
              aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
              onClick={() => onColor(swatch)}
              disabled={disabled}
              style={{ background: swatch }}
              className={cn(
                "size-4 rounded-full border transition-transform duration-100",
                color.toLowerCase() === swatch.toLowerCase()
                  ? "scale-110 border-white ring-2 ring-flow/70"
                  : "border-grid-strong hover:scale-105",
              )}
            />
          ))}
        </div>

        <span aria-hidden className="mx-1 h-4 w-px bg-grid" />

        <div role="group" aria-label="Stroke width" className="flex items-center gap-1">
          {MARKUP_WIDTHS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Stroke width ${value}`}
              aria-pressed={width === value}
              onClick={() => onWidth(value)}
              disabled={disabled}
              className={cn(
                "grid size-6 place-items-center rounded-chip border",
                width === value
                  ? "border-flow/50 bg-flow-tint"
                  : "border-grid hover:border-grid-strong",
              )}
            >
              <span
                aria-hidden
                className="rounded-full bg-primary"
                style={{ width: Math.min(14, value), height: Math.max(2, Math.round(value / 2)) }}
              />
            </button>
          ))}
        </div>

        <span className="min-w-0 flex-1" />

        <RailButton label="Undo" onClick={onUndo} disabled={disabled || !canUndo} title="Undo (Ctrl+Z)">
          ↶
        </RailButton>
        <RailButton label="Redo" onClick={onRedo} disabled={disabled || !canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </RailButton>

        <span aria-hidden className="mx-1 h-4 w-px bg-grid" />

        <RailButton label="Zoom out" onClick={onZoomOut} disabled={disabled} title="Zoom out (−)">
          −
        </RailButton>
        <span className="min-w-14 shrink-0 text-center font-machine text-hud-micro tabular-nums text-secondary">
          {zoomPercent}%
        </span>
        <RailButton label="Zoom in" onClick={onZoomIn} disabled={disabled} title="Zoom in (+)">
          +
        </RailButton>
        <RailButton label="Fit image" onClick={onResetView} disabled={disabled} title="Fit (0)">
          Fit
        </RailButton>

        <span aria-hidden className="mx-1 h-4 w-px bg-grid" />

        <RailButton
          label="Clear all markup"
          onClick={onClear}
          disabled={disabled || strokeCount === 0}
          title="Clear all strokes"
        >
          Clear
        </RailButton>
      </div>

      <p className="flex flex-wrap items-center gap-2 font-machine text-hud-micro uppercase tracking-[0.06em] text-disabled">
        <span>{strokeCount} stroke{strokeCount === 1 ? "" : "s"}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <Kbd size="xs">Space</Kbd>+drag pan
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <Kbd size="xs">Wheel</Kbd> zoom
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <Kbd size="xs">P</Kbd>/<Kbd size="xs">E</Kbd> tool
        </span>
      </p>
    </div>
  );
}
