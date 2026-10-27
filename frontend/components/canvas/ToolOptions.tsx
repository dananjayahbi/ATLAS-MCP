"use client";

/**
 * Doc 07 §4.0 palette contract — the style panel shows only the properties
 * relevant to the active tool (a blur has no colour, a text chip has no dash).
 *
 * `[` / `]` adjust width from the canvas; these sliders mirror that state so
 * the control and the keyboard never disagree.
 */
import { PALETTE } from "@/lib/canvas/defaults";
import type { EditorTool } from "@/lib/canvas/tools";
import { MAX_STROKE_WIDTH, MIN_STROKE_WIDTH, type Hex } from "@/lib/canvas/types";

export interface ToolOptionsProps {
  tool: EditorTool;
  color: Hex;
  width: number;
  opacity: number;
  blurMode: "pixelate" | "blur";
  blurStrength: number;
  fontSize: number;
  disabled: boolean;
  onColor: (color: Hex) => void;
  onWidth: (width: number) => void;
  onOpacity: (opacity: number) => void;
  onBlurMode: (mode: "pixelate" | "blur") => void;
  onBlurStrength: (strength: number) => void;
}

const SHOW_COLOUR: readonly EditorTool[] = ["pen", "rect", "arrow", "line", "text"];
const SHOW_WIDTH: readonly EditorTool[] = ["pen", "rect", "arrow", "line", "highlight"];
const SHOW_OPACITY: readonly EditorTool[] = ["pen", "rect", "arrow", "line"];

export function ToolOptions(props: ToolOptionsProps) {
  const { tool, disabled } = props;
  const showColour = SHOW_COLOUR.includes(tool);
  const showWidth = SHOW_WIDTH.includes(tool);
  const showOpacity = SHOW_OPACITY.includes(tool);
  const showBlur = tool === "blur";
  const showText = tool === "text";
  const nothing = !showColour && !showWidth && !showOpacity && !showBlur && !showText;

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--radius-hud)] border p-2"
      style={{ borderColor: "var(--border-grid)", background: "var(--surface-panel)" }}
      aria-label="Tool options"
    >
      <span
        className="font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)] uppercase tracking-[0.08em]"
        style={{ color: "var(--text-muted)" }}
      >
        Style
      </span>

      {nothing ? (
        <p className="text-[length:var(--text-hud-body)]" style={{ color: "var(--text-muted)" }}>
          {tool === "select" ? "Select a stroke to edit its style." : "No style options for this tool."}
        </p>
      ) : null}

      {showColour ? (
        <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0" disabled={disabled}>
          <legend className="sr-only">Stroke colour</legend>
          {PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={`Colour ${hex}`}
              aria-pressed={props.color.toLowerCase() === hex.toLowerCase()}
              disabled={disabled}
              onClick={() => props.onColor(hex)}
              className="h-5 w-5 rounded-[var(--radius-chip)] border"
              style={{
                background: hex,
                borderColor:
                  props.color.toLowerCase() === hex.toLowerCase()
                    ? "var(--color-flow)"
                    : "var(--border-strong)",
                outline:
                  props.color.toLowerCase() === hex.toLowerCase() ? "1px solid var(--color-flow)" : "none",
              }}
            />
          ))}
        </fieldset>
      ) : null}

      {showWidth ? (
        <label className="flex items-center gap-2 text-[length:var(--text-hud-body)]" style={{ color: "var(--text-secondary)" }}>
          <span className="w-10 shrink-0 font-[family-name:var(--font-machine)] uppercase">width</span>
          <input
            type="range"
            min={MIN_STROKE_WIDTH}
            max={48}
            step={1}
            value={props.width}
            disabled={disabled}
            aria-label="Stroke width"
            aria-valuetext={`${props.width} pixels`}
            onChange={(event) => props.onWidth(Number(event.target.value))}
            className="min-w-0 flex-1 accent-[var(--color-flow)]"
          />
          <span className="w-10 shrink-0 text-right font-[family-name:var(--font-machine)]" style={{ color: "var(--text-machine)" }}>
            {props.width}px
          </span>
        </label>
      ) : null}

      {showOpacity ? (
        <label className="flex items-center gap-2 text-[length:var(--text-hud-body)]" style={{ color: "var(--text-secondary)" }}>
          <span className="w-10 shrink-0 font-[family-name:var(--font-machine)] uppercase">alpha</span>
          <input
            type="range"
            min={55}
            max={100}
            step={1}
            value={Math.round(props.opacity * 100)}
            disabled={disabled}
            aria-label="Stroke opacity"
            aria-valuetext={`${Math.round(props.opacity * 100)} percent`}
            onChange={(event) => props.onOpacity(Number(event.target.value) / 100)}
            className="min-w-0 flex-1 accent-[var(--color-flow)]"
          />
          <span className="w-10 shrink-0 text-right font-[family-name:var(--font-machine)]" style={{ color: "var(--text-machine)" }}>
            {Math.round(props.opacity * 100)}%
          </span>
        </label>
      ) : null}

      {showBlur ? (
        <>
          <div className="flex gap-1" role="group" aria-label="Blur mode">
            {(["pixelate", "blur"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={props.blurMode === mode}
                disabled={disabled}
                onClick={() => props.onBlurMode(mode)}
                className="flex-1 rounded-[var(--radius-hud)] border px-1 py-0.5 font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)] uppercase"
                style={{
                  borderColor: props.blurMode === mode ? "var(--color-review)" : "var(--border-grid)",
                  background: props.blurMode === mode ? "var(--color-review-tint)" : "var(--surface-raised)",
                  color: props.blurMode === mode ? "var(--color-review)" : "var(--text-secondary)",
                }}
              >
                {mode}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[length:var(--text-hud-body)]" style={{ color: "var(--text-secondary)" }}>
            <span className="w-10 shrink-0 font-[family-name:var(--font-machine)] uppercase">block</span>
            <input
              type="range"
              min={2}
              max={64}
              step={1}
              value={props.blurStrength}
              disabled={disabled}
              aria-label="Blur strength"
              aria-valuetext={`${props.blurStrength} pixels`}
              onChange={(event) => props.onBlurStrength(Number(event.target.value))}
              className="min-w-0 flex-1 accent-[var(--color-review)]"
            />
            <span className="w-10 shrink-0 text-right font-[family-name:var(--font-machine)]" style={{ color: "var(--text-machine)" }}>
              {props.blurStrength}
            </span>
          </label>
        </>
      ) : null}

      {showText ? (
        <p className="text-[length:var(--text-hud-body)]" style={{ color: "var(--text-muted)" }}>
          Font {props.fontSize}px — press T then click the image.
        </p>
      ) : null}
    </div>
  );
}

export default ToolOptions;
