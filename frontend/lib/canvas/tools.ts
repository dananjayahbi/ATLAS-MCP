/**
 * Doc 07 §4.0 — the editor's tool surface.
 *
 * `EditorTool` is the UI-facing set (it includes `select` and `eraser`, which
 * never persist). `strokeToolFor` maps it onto the persisted `StrokeTool`
 * union so the document model stays exactly as §3.1 freezes it.
 */
import type { CanvasTool } from "@/lib/types/enums";
import type { StrokeTool } from "./types";

export type EditorTool =
  | "select"
  | "pen"
  | "rect"
  | "arrow"
  | "line"
  | "text"
  | "highlight"
  | "blur"
  | "eraser";

export const EDITOR_TOOLS: readonly EditorTool[] = [
  "select",
  "pen",
  "rect",
  "arrow",
  "line",
  "text",
  "highlight",
  "blur",
  "eraser",
];

export const MUTATING_TOOLS: readonly EditorTool[] = EDITOR_TOOLS.filter((t) => t !== "select");

export interface ToolMeta {
  id: EditorTool;
  /** Palette label (§4.0 wireframe). */
  name: string;
  /** Letter shortcut from §4.0/§7.9. */
  letter: string;
  /** 1–6 numeric shortcut required by the canvas shell. */
  digit: number | null;
  ariaLabel: string;
}

export const TOOL_META: Record<EditorTool, ToolMeta> = {
  select: { id: "select", name: "SELECT", letter: "V", digit: null, ariaLabel: "Selection tool" },
  pen: { id: "pen", name: "PEN", letter: "F", digit: 1, ariaLabel: "Freehand pen tool" },
  rect: { id: "rect", name: "RECT", letter: "R", digit: 2, ariaLabel: "Bounding box tool" },
  arrow: { id: "arrow", name: "ARROW", letter: "A", digit: 3, ariaLabel: "Arrow tool" },
  text: { id: "text", name: "TEXT", letter: "T", digit: 4, ariaLabel: "Text callout tool" },
  blur: { id: "blur", name: "BLUR", letter: "B", digit: 5, ariaLabel: "Privacy blur tool" },
  eraser: { id: "eraser", name: "ERASE", letter: "E", digit: 6, ariaLabel: "Eraser tool" },
  line: { id: "line", name: "LINE", letter: "L", digit: null, ariaLabel: "Line tool" },
  highlight: { id: "highlight", name: "MARK", letter: "H", digit: null, ariaLabel: "Highlight tool" },
};

/** The six tools reachable with `1`–`6` (hard requirement of the shell). */
export const DIGIT_TOOLS: readonly EditorTool[] = ["pen", "rect", "arrow", "text", "blur", "eraser"];

export function strokeToolFor(tool: EditorTool): StrokeTool | null {
  switch (tool) {
    case "pen":
      return "freehand";
    case "rect":
      return "rect";
    case "arrow":
      return "arrow";
    case "line":
      return "line";
    case "text":
      return "text";
    case "highlight":
      return "highlight";
    case "blur":
      return "blur";
    default:
      return null;
  }
}

/** Drag-to-create uses the shared arming→dragging machine (§7.4). */
export function isDragTool(tool: EditorTool): boolean {
  return (
    tool === "rect" ||
    tool === "arrow" ||
    tool === "line" ||
    tool === "highlight" ||
    tool === "blur"
  );
}

export function toolFromKey(key: string): EditorTool | null {
  const upper = key.toUpperCase();
  const byLetter = EDITOR_TOOLS.find((tool) => TOOL_META[tool].letter === upper);
  if (byLetter) return byLetter;
  const index = Number(key);
  if (Number.isInteger(index) && index >= 1 && index <= DIGIT_TOOLS.length) {
    return DIGIT_TOOLS[index - 1];
  }
  return null;
}

/** Frozen enum guard for `frontend/lib/types/enums.ts` (`pen` → `freehand`). */
export function fromFrozenTool(tool: CanvasTool): EditorTool {
  switch (tool) {
    case "pen":
      return "pen";
    case "rect":
      return "rect";
    case "arrow":
      return "arrow";
    case "text":
      return "text";
    case "blur":
      return "blur";
    case "eraser":
      return "eraser";
    default:
      return "select";
  }
}
