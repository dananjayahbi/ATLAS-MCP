"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { MarkupDocument } from "@/lib/markup/types";

/**
 * Bounded undo/redo for the markup overlay.
 *
 * Snapshot-based rather than command-based: a markup document is bounded (200
 * strokes) so a structural copy is cheaper than keeping inverse commands, and
 * undo can never drift from the rendered result.
 */

const HISTORY_CAP = 60;

export type MarkupHistory = {
  doc: MarkupDocument;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Replace the document and push the previous state onto the undo stack. */
  commit: (next: MarkupDocument) => void;
  /** Mutate without history (live drag previews, resets). */
  replace: (next: MarkupDocument) => void;
  reset: (next: MarkupDocument) => void;
  /** Commit only when the reducer actually changed something. */
  commitIfChanged: (next: MarkupDocument) => MarkupDocument;
};

export function useMarkupHistory(initial: MarkupDocument): MarkupHistory {
  const [doc, setDoc] = useState<MarkupDocument>(initial);
  const past = useRef<MarkupDocument[]>([]);
  const future = useRef<MarkupDocument[]>([]);
  const [, bump] = useState(0);

  const push = useCallback((current: MarkupDocument) => {
    past.current = [...past.current, current].slice(-HISTORY_CAP);
    future.current = [];
  }, []);

  const commit = useCallback(
    (next: MarkupDocument) => {
      setDoc((current) => {
        if (next === current) return current;
        push(current);
        return next;
      });
      bump((n) => n + 1);
    },
    [push],
  );

  const commitIfChanged = useCallback(
    (next: MarkupDocument) => {
      let resolved = next;
      setDoc((current) => {
        if (next === current) {
          resolved = current;
          return current;
        }
        push(current);
        resolved = next;
        return next;
      });
      bump((n) => n + 1);
      return resolved;
    },
    [push],
  );

  const replace = useCallback((next: MarkupDocument) => {
    setDoc(next);
    bump((n) => n + 1);
  }, []);

  const reset = useCallback((next: MarkupDocument) => {
    past.current = [];
    future.current = [];
    setDoc(next);
    bump((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const previous = past.current[past.current.length - 1];
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    setDoc((current) => {
      future.current = [current, ...future.current].slice(0, HISTORY_CAP);
      return previous;
    });
    bump((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    setDoc((current) => {
      past.current = [...past.current, current].slice(-HISTORY_CAP);
      return next;
    });
    bump((n) => n + 1);
  }, []);

  return useMemo(
    () => ({
      doc,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      undo,
      redo,
      commit,
      commitIfChanged,
      replace,
      reset,
    }),
    [doc, undo, redo, commit, commitIfChanged, replace, reset],
  );
}
