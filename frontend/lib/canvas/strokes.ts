/**
 * Doc 07 §8 — the pure document reducer: add, erase, reorder, crop, legend,
 * plus a bounded undo/redo stack.
 *
 * Commands are data (never closures) so `apply` after `revert` is provably the
 * identity (§8.1, `T-HIST-01`). History is in-memory only and never serialised
 * (§8.4).
 */
import {
  HISTORY_CAP,
  type CanvasDocument,
  type CanvasLegend,
  type CropRegion,
  type Stroke,
} from "./types";
import { makeId } from "./document";

export type CommandKind =
  | "add"
  | "delete"
  | "update"
  | "move"
  | "reorder"
  | "crop"
  | "legend";

export interface AddCommand {
  kind: "add";
  label: string;
  stroke: Stroke;
  at: number;
}
export interface DeleteCommand {
  kind: "delete";
  label: string;
  entries: Array<{ index: number; stroke: Stroke }>;
}
export interface UpdateCommand {
  kind: "update";
  label: string;
  id: string;
  prev: Stroke;
  next: Stroke;
}
export interface MoveCommand {
  kind: "move";
  label: string;
  strokes: Array<{ id: string; prev: Stroke; next: Stroke }>;
}
export interface ReorderCommand {
  kind: "reorder";
  label: string;
  id: string;
  from: number;
  to: number;
}
export interface CropCommand {
  kind: "crop";
  label: string;
  prev: CropRegion | null;
  next: CropRegion | null;
}
export interface LegendCommand {
  kind: "legend";
  label: string;
  prev: CanvasLegend | undefined;
  next: CanvasLegend;
}

export type CanvasCommand =
  | AddCommand
  | DeleteCommand
  | UpdateCommand
  | MoveCommand
  | ReorderCommand
  | CropCommand
  | LegendCommand;

export interface StrokeState {
  doc: CanvasDocument;
  undo: CanvasCommand[];
  redo: CanvasCommand[];
  /** Epoch ms of the last command, for nudge coalescing (§8.3). */
  lastCommandAt: number;
}

export const NUDGE_COALESCE_MS = 600;

export function createStrokeState(doc: CanvasDocument): StrokeState {
  return { doc, undo: [], redo: [], lastCommandAt: 0 };
}

/* ---------------------------------------------------------------- commands */

export function applyCommand(doc: CanvasDocument, cmd: CanvasCommand): CanvasDocument {
  switch (cmd.kind) {
    case "add": {
      const strokes = doc.strokes.slice();
      strokes.splice(Math.min(cmd.at, strokes.length), 0, cmd.stroke);
      return { ...doc, strokes };
    }
    case "delete": {
      const ids = new Set(cmd.entries.map((e) => e.stroke.id));
      return { ...doc, strokes: doc.strokes.filter((s) => !ids.has(s.id)) };
    }
    case "update":
      return {
        ...doc,
        strokes: doc.strokes.map((s) => (s.id === cmd.id ? cmd.next : s)),
      };
    case "move": {
      const byId = new Map(cmd.strokes.map((e) => [e.id, e.next]));
      return {
        ...doc,
        strokes: doc.strokes.map((s) => byId.get(s.id) ?? s),
      };
    }
    case "reorder": {
      const from = doc.strokes.findIndex((s) => s.id === cmd.id);
      if (from === -1) return doc;
      const strokes = doc.strokes.slice();
      const [moved] = strokes.splice(from, 1);
      strokes.splice(clampIndex(cmd.to, strokes.length), 0, moved);
      return { ...doc, strokes };
    }
    case "crop":
      return { ...doc, crop: cmd.next };
    case "legend":
      return { ...doc, legend: cmd.next };
    default:
      return doc;
  }
}

export function revertCommand(doc: CanvasDocument, cmd: CanvasCommand): CanvasDocument {
  switch (cmd.kind) {
    case "add":
      return { ...doc, strokes: doc.strokes.filter((s) => s.id !== cmd.stroke.id) };
    case "delete": {
      const strokes = doc.strokes.slice();
      // Re-insert ascending so original indices line up again (§8.1).
      for (const entry of [...cmd.entries].sort((a, b) => a.index - b.index)) {
        strokes.splice(clampIndex(entry.index, strokes.length), 0, entry.stroke);
      }
      return { ...doc, strokes };
    }
    case "update":
      return {
        ...doc,
        strokes: doc.strokes.map((s) => (s.id === cmd.id ? cmd.prev : s)),
      };
    case "move": {
      const byId = new Map(cmd.strokes.map((e) => [e.id, e.prev]));
      return {
        ...doc,
        strokes: doc.strokes.map((s) => byId.get(s.id) ?? s),
      };
    }
    case "reorder": {
      const current = doc.strokes.findIndex((s) => s.id === cmd.id);
      if (current === -1) return doc;
      const strokes = doc.strokes.slice();
      const [moved] = strokes.splice(current, 1);
      strokes.splice(clampIndex(cmd.from, strokes.length), 0, moved);
      return { ...doc, strokes };
    }
    case "crop":
      return { ...doc, crop: cmd.prev };
    case "legend":
      return { ...doc, legend: cmd.prev };
    default:
      return doc;
  }
}

/* ----------------------------------------------------------------- reducer */

export type StrokeAction =
  | { type: "commit"; command: CanvasCommand; at?: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; doc: CanvasDocument }
  | { type: "rebuild"; doc: CanvasDocument };

export function strokeReducer(state: StrokeState, action: StrokeAction): StrokeState {
  switch (action.type) {
    case "commit": {
      const doc = applyCommand(state.doc, action.command);
      const undo = pushBounded(state.undo, action.command);
      return { doc, undo, redo: [], lastCommandAt: action.at ?? Date.now() };
    }
    case "undo": {
      const command = state.undo[state.undo.length - 1];
      if (!command) return state;
      return {
        doc: revertCommand(state.doc, command),
        undo: state.undo.slice(0, -1),
        redo: [...state.redo, command],
        lastCommandAt: state.lastCommandAt,
      };
    }
    case "redo": {
      const command = state.redo[state.redo.length - 1];
      if (!command) return state;
      return {
        doc: applyCommand(state.doc, command),
        undo: pushBounded(state.undo, command),
        redo: state.redo.slice(0, -1),
        lastCommandAt: state.lastCommandAt,
      };
    }
    case "reset":
      return createStrokeState(action.doc);
    case "rebuild":
      return { ...state, doc: action.doc };
    default:
      return state;
  }
}

function pushBounded(stack: CanvasCommand[], command: CanvasCommand): CanvasCommand[] {
  const next = [...stack, command];
  if (next.length > HISTORY_CAP) next.shift();
  return next;
}

export function canUndo(state: StrokeState): boolean {
  return state.undo.length > 0;
}

export function canRedo(state: StrokeState): boolean {
  return state.redo.length > 0;
}

export function undoLabel(state: StrokeState): string | null {
  return state.undo[state.undo.length - 1]?.label ?? null;
}

export function redoLabel(state: StrokeState): string | null {
  return state.redo[state.redo.length - 1]?.label ?? null;
}

/* -------------------------------------------------------------- factories */

export function addStrokeCommand(stroke: Stroke, at?: number): AddCommand {
  return {
    kind: "add",
    label: `add ${labelForTool(stroke)}`,
    stroke,
    at: at ?? Number.MAX_SAFE_INTEGER,
  };
}

export function deleteStrokesCommand(doc: CanvasDocument, ids: Iterable<string>): DeleteCommand | null {
  const wanted = new Set(ids);
  const entries: Array<{ index: number; stroke: Stroke }> = [];
  doc.strokes.forEach((stroke, index) => {
    if (wanted.has(stroke.id)) entries.push({ index, stroke });
  });
  if (entries.length === 0) return null;
  return {
    kind: "delete",
    label: entries.length === 1 ? `delete ${labelForTool(entries[0].stroke)}` : `delete ${entries.length} strokes`,
    entries,
  };
}

export function updateStrokeCommand(prev: Stroke, next: Stroke): UpdateCommand | null {
  if (prev.id !== next.id) return null;
  return {
    kind: "update",
    label: `edit ${labelForTool(next)}`,
    id: next.id,
    prev,
    next,
  };
}

export function moveStrokesCommand(
  pairs: Array<{ prev: Stroke; next: Stroke }>,
): MoveCommand | null {
  const items = pairs.filter((p) => p.prev.id === p.next.id);
  if (items.length === 0) return null;
  return {
    kind: "move",
    label: items.length === 1 ? `move ${labelForTool(items[0].next)}` : `move ${items.length} strokes`,
    strokes: items.map((p) => ({ id: p.next.id, prev: p.prev, next: p.next })),
  };
}

export function reorderCommand(
  doc: CanvasDocument,
  id: string,
  to: number,
): ReorderCommand | null {
  const from = doc.strokes.findIndex((s) => s.id === id);
  if (from === -1 || from === to) return null;
  return { kind: "reorder", label: "reorder stroke", id, from, to };
}

export function setCropCommand(
  prev: CropRegion | null | undefined,
  next: CropRegion | null,
): CropCommand {
  return { kind: "crop", label: next ? "set crop" : "reset crop", prev: prev ?? null, next };
}

export function setLegendCommand(
  prev: CanvasLegend | undefined,
  next: CanvasLegend,
): LegendCommand {
  return { kind: "legend", label: next.enabled ? "show legend" : "hide legend", prev, next };
}

/* ------------------------------------------------------------- coalescing */

/**
 * §8.3 — consecutive nudges of the same selection inside 600 ms collapse into
 * one history entry. Returns `null` when the new command should stand alone.
 */
export function coalesceNudge(
  state: StrokeState,
  next: MoveCommand,
  at: number,
): MoveCommand | null {
  if (at - state.lastCommandAt > NUDGE_COALESCE_MS) return null;
  const previous = state.undo[state.undo.length - 1];
  if (!previous || previous.kind !== "move") return null;
  if (previous.strokes.length !== next.strokes.length) return null;
  const prevById = new Map(previous.strokes.map((s) => [s.id, s]));
  const merged = next.strokes.map((entry) => {
    const earlier = prevById.get(entry.id);
    if (!earlier) return null;
    return { id: entry.id, prev: earlier.prev, next: entry.next };
  });
  if (merged.some((m) => m === null)) return null;
  return {
    kind: "move",
    label: previous.label,
    strokes: merged as MoveCommand["strokes"],
  };
}

/** Replaces the top of the undo stack — used with `coalesceNudge`. */
export function replaceTopCommand(state: StrokeState, command: CanvasCommand): StrokeState {
  if (state.undo.length === 0) return state;
  const undo = state.undo.slice(0, -1);
  undo.push(command);
  return { ...state, undo, doc: applyCommand(state.doc, command) };
}

/* ----------------------------------------------------------------- helpers */

/** §4.0 eraser: hits are resolved by the caller's hit-test, then committed. */
export function eraseStrokes(doc: CanvasDocument, ids: Iterable<string>): DeleteCommand | null {
  return deleteStrokesCommand(doc, ids);
}

/**
 * §7.9 — `Cmd/Ctrl+D` duplicates with a `+16,+16` offset and **no** inherited
 * label, because a duplicate must not claim an existing number.
 */
export function duplicateStrokes(doc: CanvasDocument, ids: string[], offset = { x: 16, y: 16 }): Stroke[] {
  const wanted = new Set(ids);
  return doc.strokes
    .filter((s) => wanted.has(s.id))
    .map((stroke) => {
      const moved = translateStroke(stroke, offset.x, offset.y) as Stroke;
      const { label: _dropped, ...rest } = moved as Stroke & { label?: number };
      void _dropped;
      return { ...rest, id: makeId() } as Stroke;
    });
}

export function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  switch (stroke.tool) {
    case "rect":
    case "highlight":
    case "blur":
      return { ...stroke, rect: { ...stroke.rect, x: stroke.rect.x + dx, y: stroke.rect.y + dy } };
    case "line":
    case "arrow":
      return {
        ...stroke,
        from: { x: stroke.from.x + dx, y: stroke.from.y + dy },
        to: { x: stroke.to.x + dx, y: stroke.to.y + dy },
      };
    case "freehand":
      return {
        ...stroke,
        points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    case "text":
      return {
        ...stroke,
        anchor: { x: stroke.anchor.x + dx, y: stroke.anchor.y + dy },
        box: { x: stroke.box.x + dx, y: stroke.box.y + dy },
      };
    default:
      return stroke;
  }
}

export function scaleStroke(
  stroke: Stroke,
  origin: { x: number; y: number },
  scaleX: number,
  scaleY: number,
): Stroke {
  const sx = (x: number) => origin.x + (x - origin.x) * scaleX;
  const sy = (y: number) => origin.y + (y - origin.y) * scaleY;
  switch (stroke.tool) {
    case "rect":
    case "highlight":
    case "blur":
      return {
        ...stroke,
        rect: {
          x: sx(stroke.rect.x),
          y: sy(stroke.rect.y),
          w: stroke.rect.w * scaleX,
          h: stroke.rect.h * scaleY,
        },
      };
    case "line":
    case "arrow":
      return {
        ...stroke,
        from: { x: sx(stroke.from.x), y: sy(stroke.from.y) },
        to: { x: sx(stroke.to.x), y: sy(stroke.to.y) },
      };
    case "freehand":
      return {
        ...stroke,
        points: stroke.points.map((p) => ({ x: sx(p.x), y: sy(p.y) })),
      };
    case "text":
      return {
        ...stroke,
        anchor: { x: sx(stroke.anchor.x), y: sy(stroke.anchor.y) },
        box: { x: sx(stroke.box.x), y: sy(stroke.box.y) },
        wrapWidth: Math.max(40, stroke.wrapWidth * scaleX),
      };
    default:
      return stroke;
  }
}

function labelForTool(stroke: Stroke): string {
  switch (stroke.tool) {
    case "rect":
      return "rectangle";
    case "arrow":
      return "arrow";
    case "line":
      return "line";
    case "freehand":
      return "freehand";
    case "highlight":
      return "highlight";
    case "blur":
      return "blur";
    case "text":
      return "callout";
    default:
      return "stroke";
  }
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return length;
  return Math.min(Math.max(Math.floor(value), 0), length);
}
