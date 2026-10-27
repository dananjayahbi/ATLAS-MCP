"use client";

/**
 * Doc 07 §7.1 — the overlay cursor for the active tool and mode.
 */
import type { EditorTool } from "@/lib/canvas/tools";
import type { ImageStatus } from "@/lib/canvas/types";

export function buildCursor(
  tool: EditorTool,
  reviewMode: boolean,
  status: ImageStatus,
  spacePan: boolean,
): string {
  if (status !== "ready") return "progress";
  if (spacePan) return "grab";
  if (reviewMode) return "default";
  switch (tool) {
    case "select":
      return "default";
    case "text":
      return "text";
    case "eraser":
      return "cell";
    default:
      return "crosshair";
  }
}
