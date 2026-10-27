"use client";

/**
 * Doc 07 §7.9 / §12.1 — full keyboard operability.
 *
 * Handlers are bound to the canvas wrapper only (never `document`, §17.3), so
 * Doc 06's global hotkeys are untouched. Key routing lives here; the virtual
 * cursor state machine lives in `keyboard-cursor.ts`.
 */
import { useCallback, useRef } from "react";
import { TOOL_META, toolFromKey, type EditorTool } from "@/lib/canvas/tools";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/canvas/types";
import {
  createCursorController,
  type CursorController,
  type CursorHost,
} from "./keyboard-cursor";
import type { Scene } from "./scene";

export interface KeyboardApi {
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export interface KeyboardDeps extends CursorHost {
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onDuplicate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onCancelGesture: () => void;
  announce: (message: string) => void;
}

const ARROW_KEYS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  );
}

export function useCanvasKeyboard(deps: KeyboardDeps): KeyboardApi {
  const cursorRef = useRef<CursorController | null>(null);
  if (!cursorRef.current) cursorRef.current = createCursorController(deps);
  const cursor = cursorRef.current;
  cursor.update(deps);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (isTyping(event.target)) return;
      const scene = deps.sceneRef.current;
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
        handleEscape(deps, cursor, scene);
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
        cursor.enter();
        return;
      }

      const arrow = ARROW_KEYS[key];
      if (arrow) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        cursor.move(arrow.dx * step, arrow.dy * step);
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
      if (!tool) return;
      event.preventDefault();
      if (deps.reviewMode && tool !== "select") {
        deps.announce("Review mode is read-only.");
        return;
      }
      deps.setTool(tool);
      cursor.toolChanged(tool);
      deps.announce(`${TOOL_META[tool].ariaLabel} selected.`);
    },
    [cursor, deps],
  );

  const onKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === " " || event.key === "Spacebar") {
        deps.sceneRef.current.spacePan = false;
      }
    },
    [deps],
  );

  return { onKeyDown, onKeyUp };
}

function handleEscape(deps: KeyboardDeps, cursor: CursorController, scene: Scene): void {
  if (scene.pointerDown || scene.previewStroke || scene.marquee) {
    deps.onCancelGesture();
    deps.announce("Cancelled.");
    return;
  }
  if (cursor.hasAnchor()) {
    cursor.clearAnchor();
    deps.announce("Cancelled.");
    return;
  }
  if (scene.selection.size > 0) {
    scene.selection = new Set();
    deps.onSelectNone();
    deps.announce("Selection cleared.");
    return;
  }
  if (scene.keyboardCursor) {
    cursor.clearCursor();
    deps.announce("Keyboard cursor hidden.");
    return;
  }
  deps.announce("Nothing to cancel.");
}
