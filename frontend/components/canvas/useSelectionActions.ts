"use client";

/**
 * Doc 07 §7.8 / §7.9 — selection-level commands: select all, duplicate, delete,
 * reorder and nudge. They all funnel into one history command each.
 */
import { useCallback } from "react";
import { duplicateStrokes, translateStroke } from "@/lib/canvas/strokes";
import type { CanvasDocument, Stroke } from "@/lib/canvas/types";
import type { HistoryApi } from "./useCanvasHistory";

export interface SelectionActionsOptions {
  history: HistoryApi;
  getDoc: () => CanvasDocument;
  selectionIds: string[];
  setSelectionIds: (ids: string[]) => void;
  reviewMode: boolean;
  announce: (message: string) => void;
}

export interface SelectionActions {
  selectAll: () => void;
  selectNone: () => void;
  duplicate: () => void;
  remove: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  nudge: (dx: number, dy: number) => void;
}

export function useSelectionActions(options: SelectionActionsOptions): SelectionActions {
  const { history, getDoc, selectionIds, setSelectionIds, reviewMode, announce } = options;

  const selectAll = useCallback(() => {
    const ids = getDoc().strokes.map((s) => s.id);
    setSelectionIds(ids);
    announce(`All ${ids.length} annotations selected.`);
  }, [announce, getDoc, setSelectionIds]);

  const selectNone = useCallback(() => setSelectionIds([]), [setSelectionIds]);

  const duplicate = useCallback(() => {
    if (reviewMode) return;
    const copies = duplicateStrokes(getDoc(), selectionIds);
    if (copies.length === 0) return;
    copies.forEach((stroke: Stroke) => history.commitStroke(stroke));
    setSelectionIds(copies.map((s) => s.id));
    announce(`${copies.length} annotation${copies.length === 1 ? "" : "s"} duplicated.`);
  }, [announce, getDoc, history, reviewMode, selectionIds, setSelectionIds]);

  const remove = useCallback(() => {
    if (reviewMode) return;
    history.deleteStrokes(selectionIds);
    setSelectionIds([]);
  }, [history, reviewMode, selectionIds, setSelectionIds]);

  const reorder = useCallback(
    (direction: 1 | -1) => {
      if (reviewMode || selectionIds.length === 0) return;
      const strokes = getDoc().strokes;
      const id = selectionIds[selectionIds.length - 1];
      const from = strokes.findIndex((s) => s.id === id);
      if (from === -1) return;
      const to = Math.min(Math.max(from + direction, 0), strokes.length - 1);
      if (to === from) return;
      history.commit({ kind: "reorder", label: "reorder stroke", id, from, to });
    },
    [getDoc, history, reviewMode, selectionIds],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (reviewMode) return;
      history.nudgeSelection(new Set(selectionIds), dx, dy);
    },
    [history, reviewMode, selectionIds],
  );

  return {
    selectAll,
    selectNone,
    duplicate,
    remove,
    bringForward: () => reorder(1),
    sendBackward: () => reorder(-1),
    nudge,
  };
}

/** Re-exported for callers that only need the offset semantics (§7.9). */
export { translateStroke };
