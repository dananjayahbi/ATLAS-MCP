"use client";

import { useEffect } from "react";

/**
 * Doc 06 §11.6 — matrix keyboard map: `X` toggles the axis, `+/-` zoom, `0` resets.
 * Bindings are scoped to the plot so they never shadow list navigation globally.
 */

export type MatrixKeysOptions = {
  enabled: boolean;
  onToggleAxis: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
};

const IGNORED_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useMatrixKeys({ enabled, onToggleAxis, onZoomIn, onZoomOut, onReset }: MatrixKeysOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (IGNORED_TAGS.has(target.tagName) || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      switch (event.key) {
        case "x":
        case "X":
          event.preventDefault();
          onToggleAxis();
          break;
        case "+":
        case "=":
          event.preventDefault();
          onZoomIn();
          break;
        case "-":
        case "_":
          event.preventDefault();
          onZoomOut();
          break;
        case "0":
          event.preventDefault();
          onReset();
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, onReset, onToggleAxis, onZoomIn, onZoomOut]);
}
