"use client";

/**
 * Doc 07 §4.0 wireframe — the left control column: palette, style, history,
 * legend, vision mode.
 */
import { useEngine } from "./engine-context";
import { HistoryControls } from "./HistoryControls";
import { LegendToggle } from "./LegendToggle";
import { ToolOptions } from "./ToolOptions";
import { ToolPalette } from "./ToolPalette";

export interface ChromeColumnProps {
  reviewMode: boolean;
}

export function ChromeColumn({ reviewMode }: ChromeColumnProps) {
  const engine = useEngine();
  return (
    <aside
      className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto"
      aria-label="Annotation controls"
    >
      <ToolPalette activeTool={engine.tool} onSelect={engine.setTool} disabled={reviewMode} />
      <ToolOptions
        tool={engine.tool}
        color={engine.color}
        width={engine.width}
        opacity={engine.opacity}
        blurMode={engine.blurMode}
        blurStrength={engine.blurStrength}
        fontSize={engine.fontSize}
        disabled={reviewMode}
        onColor={engine.setColor}
        onWidth={engine.setWidth}
        onOpacity={engine.setOpacity}
        onBlurMode={engine.setBlurMode}
        onBlurStrength={engine.setBlurStrength}
      />
      <HistoryControls
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
        undoLabel={engine.undoText}
        redoLabel={engine.redoText}
        canDelete={engine.selectionIds.length > 0}
        disabled={reviewMode}
        onUndo={engine.undo}
        onRedo={engine.redo}
        onDelete={engine.deleteSelection}
        onBringForward={engine.bringForward}
        onSendBackward={engine.sendBackward}
      />
      <LegendToggle
        enabled={engine.legendEnabled}
        items={engine.legendItems}
        disabled={reviewMode}
        onToggle={engine.toggleLegend}
        onItemText={engine.setLegendItemText}
      />
      <label
        className="flex items-center gap-2 text-[length:var(--text-hud-body)]"
        style={{ color: "var(--text-secondary)" }}
      >
        <input
          type="checkbox"
          checked={engine.visionMode}
          onChange={(event) => engine.setVisionMode(event.target.checked)}
          aria-label="High-contrast vision mode"
          className="accent-[var(--color-flow)]"
        />
        <span className="font-[family-name:var(--font-machine)] uppercase tracking-[0.06em]">
          Vision mode
        </span>
      </label>
      {engine.restored?.savedAt ? (
        <p className="text-[length:var(--text-hud-body)]" style={{ color: "var(--text-muted)" }}>
          Draft buffer: {new Date(engine.restored.savedAt).toLocaleString()}
        </p>
      ) : null}
    </aside>
  );
}

export default ChromeColumn;
