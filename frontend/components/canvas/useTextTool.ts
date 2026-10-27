"use client";

/**
 * Doc 07 §4.6 — the text callout draft lifecycle.
 *
 * A draft is ephemeral UI state (never persisted); the committed `TextStroke`
 * derives its chip size from `text` + `fontSize` + `wrapWidth` at render time.
 */
import { useCallback, useState } from "react";
import { defaultWrapWidth } from "@/lib/canvas/defaults";
import { makeId, nextLabel } from "@/lib/canvas/document";
import { MAX_TEXT_CHARS, type CanvasDocument, type Point, type Stroke, type StrokeStyle } from "@/lib/canvas/types";

export interface TextDraft {
  anchor: Point;
  box: Point;
  value: string;
}

export interface TextToolOptions {
  getDoc: () => CanvasDocument;
  commitStroke: (stroke: Stroke) => void;
  style: StrokeStyle;
  fontSize: number;
  reviewMode: boolean;
}

export interface TextTool {
  draft: TextDraft | null;
  /** Opens the textarea at `anchor` with the chip at `box`. */
  begin: (anchor: Point, box: Point) => void;
  commit: (value: string) => void;
  cancel: () => void;
  /** §4.6 — chip offset that flips near the right/bottom edge. */
  offsetFor: (anchor: Point) => Point;
}

export function defaultChipOffset(image: { w: number; h: number }, anchor: Point): Point {
  const wrap = defaultWrapWidth(image);
  const flipX = anchor.x > image.w - wrap - 64;
  const flipY = anchor.y < 96;
  return {
    x: flipX ? Math.max(8, anchor.x - wrap - 28) : anchor.x + 28,
    y: flipY ? anchor.y + 40 : Math.max(8, anchor.y - 72),
  };
}

export function useTextTool(options: TextToolOptions): TextTool {
  const [draft, setDraft] = useState<TextDraft | null>(null);
  const { getDoc, commitStroke, style, fontSize, reviewMode } = options;

  const begin = useCallback(
    (anchor: Point, box: Point) => {
      if (reviewMode) return;
      setDraft({ anchor, box, value: "" });
    },
    [reviewMode],
  );

  const commit = useCallback(
    (value: string) => {
      const current = draft;
      setDraft(null);
      if (!current) return;
      const trimmed = value.trim().slice(0, MAX_TEXT_CHARS);
      if (trimmed.length === 0) return;
      const doc = getDoc();
      commitStroke({
        id: makeId(),
        tool: "text",
        style: { ...style, dash: null },
        createdAt: Date.now(),
        label: nextLabel(doc),
        anchor: current.anchor,
        box: current.box,
        text: trimmed,
        fontSize,
        wrapWidth: defaultWrapWidth(doc.imageNaturalSize),
      });
    },
    [commitStroke, draft, fontSize, getDoc, style],
  );

  const cancel = useCallback(() => setDraft(null), []);

  return {
    draft,
    begin,
    commit,
    cancel,
    offsetFor: (anchor: Point) => defaultChipOffset(getDoc().imageNaturalSize, anchor),
  };
}
