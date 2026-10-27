"use client";

/**
 * Doc 07 §12.1 — keyboard wiring: turns the virtual cursor into committed
 * strokes and forwards the §7.9 shortcuts to history/selection/zoom.
 */
import { useCallback, useMemo } from "react";
import { nextLabel } from "@/lib/canvas/document";
import { setLegendCommand } from "@/lib/canvas/strokes";
import type { CanvasDocument, LegendItem, Point, StrokeStyle } from "@/lib/canvas/types";
import { buildKeyboardStroke } from "./keyboard-stroke";
import type { Scene } from "./scene";
import type { HistoryApi } from "./useCanvasHistory";
import { useCanvasKeyboard } from "./useCanvasKeyboard";
import type { LegendState } from "./useLegendState";
import type { SelectionActions } from "./useSelectionActions";
import type { TextTool } from "./useTextTool";
import type { ToolState } from "./useToolState";

export interface EngineKeyboardOptions {
  sceneRef: { current: Scene };
  history: HistoryApi;
  tools: ToolState;
  text: TextTool;
  selection: SelectionActions;
  legend: LegendState;
  getDoc: () => CanvasDocument;
  reviewMode: boolean;
  invalidate: (layer?: "base" | "ink" | "overlay" | "all") => void;
  onCancelGesture: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  announce: (message: string) => void;
}

export interface EngineKeyboard {
  keyboard: ReturnType<typeof useCanvasKeyboard>;
  toggleLegend: (enabled: boolean) => void;
}

export function useEngineKeyboard(options: EngineKeyboardOptions): EngineKeyboard {
  const {
    sceneRef,
    history,
    tools,
    text,
    selection,
    legend,
    getDoc,
    reviewMode,
    invalidate,
    onCancelGesture,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    announce,
  } = options;

  const commitKeyboardStroke = useCallback(
    (from: Point, to: Point, alt: boolean) => {
      if (reviewMode) return;
      const rect = {
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        w: Math.abs(to.x - from.x),
        h: Math.abs(to.y - from.y),
      };
      if (rect.w < 2 || rect.h < 2) {
        announce("Region too small.");
        return;
      }
      if (tools.tool === "text") {
        text.begin(from, to);
        return;
      }
      history.commitStroke(
        buildKeyboardStroke({
          tool: tools.tool,
          from,
          to,
          rect,
          style: tools.style,
          label: alt ? undefined : nextLabel(getDoc()),
          blurMode: tools.blurMode,
          blurStrength: tools.blurStrength,
        }),
      );
    },
    [announce, getDoc, history, reviewMode, text, tools],
  );

  const keyboard = useCanvasKeyboard({
    sceneRef,
    tool: tools.tool,
    setTool: tools.setTool,
    reviewMode,
    width: tools.width,
    setWidth: tools.setWidth,
    fontSize: tools.fontSize,
    setFontSize: tools.setFontSize,
    style: tools.style,
    blurMode: tools.blurMode,
    blurStrength: tools.blurStrength,
    onUndo: history.undo,
    onRedo: history.redo,
    onDelete: selection.remove,
    onSelectAll: selection.selectAll,
    onDuplicate: selection.duplicate,
    onNudge: selection.nudge,
    onSelectNone: selection.selectNone,
    onRepaint: () => invalidate("overlay"),
    onPreview: (stroke, blur) => {
      sceneRef.current.previewStroke = stroke;
      sceneRef.current.previewBlur = blur;
      invalidate("overlay");
      if (blur) invalidate("base");
    },
    onCommitKeyboardStroke: commitKeyboardStroke,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onCancelGesture,
    announce,
  });

  const toggleLegend = useCallback(
    (enabled: boolean) => {
      legend.setEnabled(enabled);
      history.commit(setLegendCommand(getDoc().legend, { enabled, items: legend.items }));
    },
    [getDoc, history, legend],
  );

  return { keyboard, toggleLegend };
}

/** Kept separate so the engine can project without re-deriving legend rows. */
export function useLegendProjection(legend: LegendState): LegendItem[] {
  return useMemo(() => legend.items, [legend.items]);
}

export type { StrokeStyle };
