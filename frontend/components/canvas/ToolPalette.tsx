"use client";

/**
 * Doc 07 §4.0 — the tool palette.
 *
 * `role="toolbar"` with a roving `tabIndex`, `aria-pressed` per tool and
 * `aria-keyshortcuts` matching the §7.9 bindings. Doc 05 `HudButton` is
 * imported by Doc 06's shell; this component stays dependency-free and uses the
 * frozen tokens directly so it works before the UI kit lands.
 */
import { EDITOR_TOOLS, TOOL_META, type EditorTool } from "@/lib/canvas/tools";

export interface ToolPaletteProps {
  activeTool: EditorTool;
  onSelect: (tool: EditorTool) => void;
  disabled: boolean;
  /** Columns in the palette grid (§4.0 wireframe is 4 wide). */
  columns?: number;
}

const PALETTE_ORDER: readonly EditorTool[] = [
  "select",
  "pen",
  "rect",
  "arrow",
  "line",
  "text",
  "highlight",
  "blur",
  "eraser",
];

export function ToolPalette({ activeTool, onSelect, disabled, columns = 4 }: ToolPaletteProps) {
  const ordered = PALETTE_ORDER.filter((tool) => EDITOR_TOOLS.includes(tool));
  const activeIndex = ordered.indexOf(activeTool);

  return (
    <div
      role="toolbar"
      aria-label="Annotation tools"
      aria-orientation="horizontal"
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {ordered.map((tool, index) => {
        const meta = TOOL_META[tool];
        const pressed = tool === activeTool;
        return (
          <button
            key={tool}
            type="button"
            data-tool={tool}
            aria-pressed={pressed}
            aria-keyshortcuts={meta.digit ? `${meta.letter} ${meta.digit}` : meta.letter}
            aria-label={meta.ariaLabel}
            title={`${meta.name} — ${meta.letter}${meta.digit ? ` or ${meta.digit}` : ""}`}
            disabled={disabled && tool !== "select"}
            tabIndex={pressed || (activeIndex === -1 && index === 0) ? 0 : -1}
            onClick={() => onSelect(tool)}
            className="flex h-8 items-center justify-center rounded-[var(--radius-hud)] border px-1 font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)] tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: pressed ? "var(--color-flow)" : "var(--border-grid)",
              background: pressed ? "var(--color-flow-tint)" : "var(--surface-raised)",
              color: pressed ? "var(--text-machine)" : "var(--text-secondary)",
            }}
          >
            {meta.name}
          </button>
        );
      })}
    </div>
  );
}

export default ToolPalette;
