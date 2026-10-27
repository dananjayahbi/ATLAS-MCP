"use client";

/**
 * Doc 07 §8 / §3 — document history plumbing used by `useCanvasEngine`.
 *
 * Wraps `strokeReducer` so callers only see `commit`/`undo`/`redo` plus the
 * announcements each requires, and keeps the reducer state in a ref so a
 * pointer-driven commit never re-reads a stale `useState` closure.
 */
import { useCallback, useRef, useState } from "react";
import {
  addStrokeCommand,
  canRedo,
  canUndo,
  createStrokeState,
  deleteStrokesCommand,
  moveStrokesCommand,
  redoLabel,
  replaceTopCommand,
  strokeReducer,
  translateStroke,
  undoLabel,
  type CanvasCommand,
  type StrokeState,
} from "@/lib/canvas/strokes";
import type { CanvasDocument, Stroke } from "@/lib/canvas/types";
import { describeStroke } from "./describe";
import { mergeNudge } from "./legend";

export interface HistoryApi {
  doc: CanvasDocument;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoText: string | null;
  redoText: string | null;
  /** Replaces the announcer without recreating the reducer state. */
  setAnnouncer: (announce: (message: string) => void) => void;
  commit: (command: CanvasCommand) => void;
  commitStroke: (stroke: Stroke) => void;
  replaceStrokes: (pairs: Array<{ prev: Stroke; next: Stroke }>) => void;
  deleteStrokes: (ids: string[]) => void;
  nudgeSelection: (ids: ReadonlySet<string>, dx: number, dy: number) => void;
  undo: () => void;
  redo: () => void;
  replaceAll: (doc: CanvasDocument) => void;
  markClean: () => void;
  current: () => CanvasDocument;
}

export function useCanvasHistory(
  initialDoc: CanvasDocument,
  announceInitial: (message: string) => void,
): HistoryApi {
  const stateRef = useRef<StrokeState>(createStrokeState(initialDoc));
  const [doc, setDoc] = useState<CanvasDocument>(initialDoc);
  const [dirty, setDirty] = useState(false);
  const [, bumpVersion] = useState(0);
  const announceRef = useRef(announceInitial);
  announceRef.current = announceInitial;

  const announce = useCallback((message: string) => announceRef.current(message), []);

  const publish = useCallback((next: StrokeState) => {
    stateRef.current = next;
    setDoc(next.doc);
    bumpVersion((n) => n + 1);
  }, []);

  const commit = useCallback(
    (command: CanvasCommand) => {
      publish(strokeReducer(stateRef.current, { type: "commit", command }));
      setDirty(true);
    },
    [publish],
  );

  const commitStroke = useCallback(
    (stroke: Stroke) => {
      commit(addStrokeCommand(stroke));
      const total = stateRef.current.doc.strokes.length + 1;
      announce(`${describeStroke(stroke)} added. ${total} annotation${total === 1 ? "" : "s"} total.`);
    },
    [announce, commit],
  );

  const replaceStrokes = useCallback(
    (pairs: Array<{ prev: Stroke; next: Stroke }>) => {
      const command = moveStrokesCommand(pairs);
      if (command) commit(command);
    },
    [commit],
  );

  const deleteStrokes = useCallback(
    (ids: string[]) => {
      const command = deleteStrokesCommand(stateRef.current.doc, ids);
      if (!command) return;
      commit(command);
      announce(`${ids.length} annotation${ids.length === 1 ? "" : "s"} deleted.`);
    },
    [announce, commit],
  );

  const nudgeSelection = useCallback(
    (ids: ReadonlySet<string>, dx: number, dy: number) => {
      const moving = stateRef.current.doc.strokes.filter((s) => ids.has(s.id));
      if (moving.length === 0) return;
      const command = moveStrokesCommand(
        moving.map((s) => ({ prev: s, next: translateStroke(s, dx, dy) })),
      );
      if (!command) return;
      const merged = mergeNudge(stateRef.current, command, Date.now());
      if (merged) {
        publish(replaceTopCommand(stateRef.current, merged));
        setDirty(true);
        return;
      }
      commit(command);
    },
    [commit, publish],
  );

  const undo = useCallback(() => {
    const before = stateRef.current;
    const next = strokeReducer(before, { type: "undo" });
    if (next === before) return;
    publish(next);
    setDirty(true);
    announce(`Undone: ${undoLabel(before) ?? "last action"}.`);
  }, [announce, publish]);

  const redo = useCallback(() => {
    const before = stateRef.current;
    const next = strokeReducer(before, { type: "redo" });
    if (next === before) return;
    publish(next);
    setDirty(true);
    announce(`Redone: ${redoLabel(before) ?? "last action"}.`);
  }, [announce, publish]);

  const replaceAll = useCallback(
    (next: CanvasDocument) => {
      publish(createStrokeState(next));
      setDirty(false);
    },
    [publish],
  );

  const state = stateRef.current;
  return {
    doc,
    dirty,
    canUndo: canUndo(state),
    canRedo: canRedo(state),
    undoText: undoLabel(state),
    redoText: redoLabel(state),
    setAnnouncer: (next) => {
      announceRef.current = next;
    },
    commit,
    commitStroke,
    replaceStrokes,
    deleteStrokes,
    nudgeSelection,
    undo,
    redo,
    replaceAll,
    markClean: () => setDirty(false),
    current: () => stateRef.current.doc,
  };
}
