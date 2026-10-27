"use client";

/**
 * Doc 07 §12.1 — the keyboard virtual cursor and the anchor/size/commit state
 * machine. It produces the same `Stroke` geometry as the pointer flow because
 * both go through `keyboard-stroke.ts` / `interaction.ts` defaults.
 */
import type { Point, Rect, Stroke, StrokeStyle } from "@/lib/canvas/types";
import type { EditorTool } from "@/lib/canvas/tools";
import { previewForRect } from "./keyboard-stroke";
import type { Scene } from "./scene";

export interface CursorHost {
  sceneRef: { current: Scene };
  tool: EditorTool;
  setTool: (tool: EditorTool) => void;
  reviewMode: boolean;
  width: number;
  setWidth: (width: number) => void;
  fontSize: number;
  setFontSize: (fontSize: number) => void;
  style: StrokeStyle;
  blurMode: "pixelate" | "blur";
  blurStrength: number;
  onNudge: (dx: number, dy: number) => void;
  onSelectNone: () => void;
  onRepaint: () => void;
  onPreview: (stroke: Stroke | null, blur: Rect | null) => void;
  onCommitKeyboardStroke: (from: Point, to: Point, alt: boolean) => void;
  announce: (message: string) => void;
}

export interface CursorController {
  update: (host: CursorHost) => void;
  enter: () => void;
  move: (dx: number, dy: number) => void;
  toolChanged: (tool: EditorTool) => void;
  hasAnchor: () => boolean;
  clearAnchor: () => void;
  clearCursor: () => void;
}

export function createCursorController(initial: CursorHost): CursorController {
  let host = initial;
  let cursor: Point | null = null;
  let anchor: Point | null = null;

  const clampToImage = (point: Point): Point => {
    const size = host.sceneRef.current.doc.imageNaturalSize;
    return {
      x: Math.min(Math.max(point.x, 0), size.w),
      y: Math.min(Math.max(point.y, 0), size.h),
    };
  };

  const setCursor = (point: Point): void => {
    cursor = clampToImage(point);
    host.sceneRef.current.keyboardCursor = cursor;
    host.onRepaint();
  };

  const describeCursor = (verb: string): void => {
    if (!cursor) return;
    host.announce(`${verb} x ${Math.round(cursor.x)}, y ${Math.round(cursor.y)}.`);
  };

  const preview = (): void => {
    if (!anchor || !cursor) {
      host.onPreview(null, null);
      return;
    }
    const rect: Rect = {
      x: Math.min(anchor.x, cursor.x),
      y: Math.min(anchor.y, cursor.y),
      w: Math.abs(cursor.x - anchor.x),
      h: Math.abs(cursor.y - anchor.y),
    };
    host.onPreview(
      previewForRect(host.tool, rect, host.style),
      host.tool === "blur" ? rect : null,
    );
    host.announce(`Size ${Math.round(rect.w)} by ${Math.round(rect.h)}.`);
  };

  return {
    update(next) {
      host = next;
    },
    enter() {
      const size = host.sceneRef.current.doc.imageNaturalSize;
      if (!cursor) {
        setCursor({ x: size.w / 2, y: size.h / 2 });
        host.announce(
          `${host.tool === "select" ? "Rectangle" : host.tool} tool. Press Enter to place a region at the cursor.`,
        );
        return;
      }
      if (!anchor) {
        anchor = { ...cursor };
        host.onPreview(null, null);
        describeCursor("Anchor set at");
        return;
      }
      const from = anchor;
      anchor = null;
      host.onPreview(null, null);
      host.onCommitKeyboardStroke(from, cursor, false);
    },
    move(dx, dy) {
      if (anchor && cursor) {
        setCursor({ x: cursor.x + dx, y: cursor.y + dy });
        preview();
        return;
      }
      if (cursor) {
        setCursor({ x: cursor.x + dx, y: cursor.y + dy });
        describeCursor("Cursor at");
        return;
      }
      if (host.sceneRef.current.selection.size > 0) {
        host.onNudge(dx, dy);
        return;
      }
      const size = host.sceneRef.current.doc.imageNaturalSize;
      setCursor({ x: size.w / 2, y: size.h / 2 });
      describeCursor("Cursor at");
    },
    toolChanged(tool) {
      anchor = null;
      host.onPreview(null, null);
      if (tool === "select") {
        if (cursor) {
          cursor = null;
          host.sceneRef.current.keyboardCursor = null;
          host.onRepaint();
        }
        return;
      }
      const size = host.sceneRef.current.doc.imageNaturalSize;
      setCursor(cursor ?? { x: size.w / 2, y: size.h / 2 });
    },
    hasAnchor() {
      return anchor !== null;
    },
    clearAnchor() {
      anchor = null;
      host.onPreview(null, null);
    },
    clearCursor() {
      cursor = null;
      anchor = null;
      host.sceneRef.current.keyboardCursor = null;
      host.onPreview(null, null);
    },
  };
}
