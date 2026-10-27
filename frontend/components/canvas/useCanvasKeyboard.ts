"use client";

/**
 * Doc 07 §7.9 / §12.1 — full keyboard operability.
 *
 * Handlers are bound to the canvas wrapper only (never `document`, §17.3), so
 * Doc 06's global hotkeys are untouched. The virtual cursor produces the exact
 * same `Stroke` geometry as the pointer flow (§12.1).
 */
import { useCallback, useRef } from "react";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, type Point, type Rect } from "@/lib/canvas/types";
import { DIGIT_TOOLS, TOOL_META, toolFromKey, type EditorTool } from "@/lib/canvas/tools";
import type { Scene } from "./scene";

export interface KeyboardApi {
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => void;
  /** Virtual cursor position in image px, or `null` when inactive. */
  cursor: Point | null;
  /** Anchor of a keyboard-started shape, or `null`. */
  anchor: Point | null;
}

export interface KeyboardDeps {
  sceneRef: { current: Scene };
  tool: EditorTool;
  setTool: (tool: EditorTool) => void;
  reviewMode: boolean;
  width: number;
  setWidth: (width: number) => void;
  fontSize: number;
  setFontSize: (fontSize: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onDuplicate: () => void;
  onNudge: (dx: number, dy: number) => void;
  onSelectNone: () => void;
  onCommitKeyboardStroke: (from: Point, to: Point, alt: boolean) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  /** §7.4 — Esc aborts an in-progress drag before clearing selection. */
  onCancelGesture: () => void;
  announce: (message: string) => void;
}

const MIN_CURSOR = 0;

export function useCanvasKeyboard(deps: KeyboardDeps): KeyboardApi {
  const cursorRef = useRef<Point | null>(null);
  const anchorRef = useRef<Point | null>(null);
  const sceneRef = deps.sceneRef;

  const setCursor = useCallback(
    (point: Point) => {
      const scene = sceneRef.current;
      const clamped = {
        x: Math.min(Math.max(point.x, MIN_CURSOR), scene.doc.imageNaturalSize.w),
        y: Math.min(Math.max(point.y, MIN_CURSOR), scene.doc.imageNaturalSize.h),
      };
      cursorRef.current = clamped;
      scene.keyboardCursor = clamped;
    },
    [sceneRef],
  );

  const announceCursor = useCallback(
    (verb: string) => {
      const cursor = cursorRef.current;
      if (!cursor) return;
      deps.announce(`${verb} x ${Math.round(cursor.x)}, y ${Math.round(cursor.y)}.`);
    },
    [deps],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const scene = sceneRef.current;
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key;

      if (mod && key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) deps.onRedo();
        else deps.onUndo();
        return;
      }
      if (mod && key.toLowerCase() === "y") {
        event.preventDefault();
        deps.onRedo();
        return;
      }
      if (mod && key.toLowerCase() === "a") {
        event.preventDefault();
        deps.onSelectAll();
        return;
      }
      if (mod && key.toLowerCase() === "d") {
        event.preventDefault();
        deps.onDuplicate();
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        event.preventDefault();
        deps.onDelete();
        return;
      }
      if (key === "Escape") {
        event.preventDefault();
        if (scene.pointerDown || scene.previewStroke || scene.marquee) {
          deps.onCancelGesture();
          deps.announce("Cancelled.");
        } else if (anchorRef.current) {
          anchorRef.current = null;
          scene.previewStroke = null;
          scene.previewBlur = null;
          scene.keyboardCursor = null;
          cursorRef.current = null;
          deps.onCancelGesture();
          deps.announce("Cancelled.");
        } else if (scene.selection.size > 0) {
          scene.selection = new Set();
          deps.onSelectNone();
          deps.announce("Selection cleared.");
        } else if (scene.keyboardCursor) {
          cursorRef.current = null;
          scene.keyboardCursor = null;
          deps.onCancelGesture();
          deps.announce("Keyboard cursor hidden.");
        } else {
          deps.announce("Nothing to cancel.");
        }
        return;
      }
      if (key === " " || key === "Spacebar") {
        event.preventDefault();
        scene.spacePan = true;
        deps.onCancelGesture();
        return;
      }
      if (key === "Enter") {
        event.preventDefault();
        if (!cursorRef.current) {
          const size = scene.doc.imageNaturalSize;
          setCursor({ x: size.w / 2, y: size.h / 2 });
          deps.announce(`${TOOL_META[deps.tool].ariaLabel}. Press Enter to place a region at the cursor.`);
          return;
        }
        if (!anchorRef.current) {
          anchorRef.current = { ...cursorRef.current };
          announceCursor("Anchor set at");
          return;
        }
        deps.onCommitKeyboardStroke(anchorRef.current, cursorRef.current, event.altKey);
        anchorRef.current = null;
        return;
      }

      const arrowKeys: Record<string, { dx: number; dy: number }> = {
        ArrowLeft: { dx: -1, dy: 0 },
        ArrowRight: { dx: 1, dy: 0 },
        ArrowUp: { dx: 0, dy: -1 },
        ArrowDown: { dx: 0, dy: 1 },
      };
      const arrow = arrowKeys[key];
      if (arrow) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = arrow.dx * step;
        const dy = arrow.dy * step;
        if (anchorRef.current && cursorRef.current) {
          setCursor({ x: cursorRef.current.x + dx, y: cursorRef.current.y + dy });
          const anchor = anchorRef.current;
          const cursor = cursorRef.current;
          if (cursor) {
            const rect: Rect = {
              x: Math.min(anchor.x, cursor.x),
              y: Math.min(anchor.y, cursor.y),
              w: Math.abs(cursor.x - anchor.x),
              h: Math.abs(cursor.y - anchor.y),
            };
            deps.announce(`Size ${Math.round(rect.w)} by ${Math.round(rect.h)}.`);
          }
        } else if (cursorRef.current) {
          setCursor({ x: cursorRef.current.x + dx, y: cursorRef.current.y + dy });
          announceCursor("Cursor at");
        } else if (scene.selection.size > 0) {
          deps.onNudge(dx, dy);
        } else {
          setCursor({ x: scene.doc.imageNaturalSize.w / 2, y: scene.doc.imageNaturalSize.h / 2 });
          announceCursor("Cursor at");
        }
        return;
      }

      if (key === "[" || key === "]") {
        event.preventDefault();
        const next = Math.min(48, Math.max(3, deps.width + (key === "]" ? 1 : -1)));
        deps.setWidth(next);
        deps.announce(`Stroke width ${next} pixels.`);
        return;
      }
      if (key === "+" || key === "=") {
        event.preventDefault();
        deps.onZoomIn();
        return;
      }
      if (key === "-" || key === "_") {
        event.preventDefault();
        deps.onZoomOut();
        return;
      }
      if (key === "0") {
        event.preventDefault();
        deps.onZoomReset();
        return;
      }
      if (event.shiftKey && (key === "<" || key === ">" || key === "," || key === ".")) {
        event.preventDefault();
        const delta = key === ">" || key === "." ? 2 : -2;
        const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, deps.fontSize + delta));
        deps.setFontSize(next);
        deps.announce(`Font size ${next} pixels.`);
        return;
      }

      const tool = toolFromKey(key);
      if (tool) {
        event.preventDefault();
        if (deps.reviewMode && tool !== "select") {
          deps.announce("Review mode is read-only.");
          return;
        }
        deps.setTool(tool);
        deps.announce(`${TOOL_META[tool].ariaLabel} selected.`);
        if (tool !== "select") {
          const size = scene.doc.imageNaturalSize;
          setCursor(cursorRef.current ?? { x: size.w / 2, y: size.h / 2 });
        }
      }
    },
    [announceCursor, deps, sceneRef, setCursor],
  );

  const onKeyUp = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === " " || event.key === "Spacebar") {
      sceneRef.current.spacePan = false;
    }
  }, [sceneRef]);

  return { onKeyDown, onKeyUp, cursor: cursorRef.current, anchor: anchorRef.current };
}

export { DIGIT_TOOLS };
