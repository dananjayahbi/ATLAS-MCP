/**
 * Doc 07 §15.1 — geometry + history self-check (framework-free, no DOM).
 */
import {
  hitTestHandle,
  hitsRectOutline,
  normaliseRect,
  resizeRectByHandle,
  snapAngle,
  strokeBBox,
  toImageSpace,
  toScreenSpace,
} from "../geometry";
import {
  addStrokeCommand,
  canRedo,
  canUndo,
  createStrokeState,
  deleteStrokesCommand,
  redoLabel,
  strokeReducer,
  undoLabel,
} from "../strokes";
import { createEmptyDocument, makeId } from "../document";
import { HISTORY_CAP, type CanvasDocument, type RectStroke } from "../types";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(name);
}

function equal<T>(name: string, actual: T, expected: T): void {
  check(`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, Object.is(actual, expected));
}

const measure = (text: string, _font: string): number => text.length * 8;

function rectStroke(overrides: Partial<RectStroke> = {}): RectStroke {
  return {
    id: makeId(),
    tool: "rect",
    rect: { x: 100, y: 100, w: 200, h: 100 },
    style: { color: "#FF3B30", width: 6, opacity: 1 },
    label: 1,
    createdAt: 1,
    ...overrides,
  };
}

function empty(): CanvasDocument {
  return createEmptyDocument("asset-1", { w: 1280, h: 720 });
}

/* ------------------------------------------------------------- geometry */

const view = { scale: 2, tx: 10, ty: 20 };
const screen = toScreenSpace({ x: 50, y: 60 }, view);
equal("T-GEO-1 image to screen x", screen.x, 110);
equal("T-GEO-2 image to screen y", screen.y, 140);
const back = toImageSpace(screen, view);
check("T-GEO-3 screen to image round-trips", Math.abs(back.x - 50) < 1e-9 && Math.abs(back.y - 60) < 1e-9);

const normalised = normaliseRect({ x: 120, y: 140 }, { x: 100, y: 100 });
check(
  "T-GEO-4 normaliseRect yields non-negative size",
  normalised.w === 20 && normalised.h === 40 && normalised.x === 100,
);

const bbox = strokeBBox(rectStroke(), measure);
check("T-GEO-5 strokeBBox equals the rect for a rect stroke", bbox.x === 100 && bbox.w === 200 && bbox.h === 100);

check(
  "T-GEO-6 hitTestHandle finds the corner",
  hitTestHandle(toScreenSpace({ x: 100, y: 100 }, view), bbox, view) === "nw",
);
check("T-GEO-7 hitTestHandle misses far away", hitTestHandle({ x: 900, y: 900 }, bbox, view) === null);

const outline = hitsRectOutline({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 1 }, 4);
check("T-GEO-8 hitsRectOutline detects the top edge", outline);
check("T-GEO-9 hitsRectOutline ignores the interior", !hitsRectOutline({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50 }, 4));

const grown = resizeRectByHandle({ x: 0, y: 0, w: 100, h: 50 }, "se", { x: 100, y: 50 });
check("T-GEO-10 handle resize grows from origin", grown.w === 200 && grown.h === 100);

const snapped = snapAngle({ x: 0, y: 0 }, { x: 100, y: 4 }, 15);
check("T-GEO-11 snapAngle quantises to 15 degrees", Math.abs(snapped.y) < 1e-6);

const simplified = snapAngle({ x: 0, y: 0 }, { x: 100, y: 100 }, 15);
check("T-GEO-12 snapAngle keeps 45 degrees", Math.abs(simplified.x - simplified.y) < 1e-6);

/* -------------------------------------------------------------- history */

const initial = empty();
let state = createStrokeState(initial);
check("T-HIST-1 fresh state cannot undo", !canUndo(state) && !canRedo(state));

const stroke = rectStroke();
state = strokeReducer(state, { type: "commit", command: addStrokeCommand(stroke) });
equal("T-HIST-2 commit appends the stroke", state.doc.strokes.length, 1);
check("T-HIST-3 commit enables undo", canUndo(state));
check("T-HIST-4 undo label names the command", (undoLabel(state) ?? "").length > 0);

state = strokeReducer(state, { type: "undo" });
equal("T-HIST-5 undo removes the stroke", state.doc.strokes.length, 0);
check("T-HIST-6 undo enables redo", canRedo(state));
check("T-HIST-7 redo label names the command", (redoLabel(state) ?? "").length > 0);

state = strokeReducer(state, { type: "redo" });
equal("T-HIST-8 redo restores the stroke", state.doc.strokes.length, 1);

const removal = deleteStrokesCommand(state.doc, [stroke.id]);
if (removal) state = strokeReducer(state, { type: "commit", command: removal });
equal("T-HIST-9 delete clears the stroke", state.doc.strokes.length, 0);

let bounded = createStrokeState(empty());
for (let i = 0; i < HISTORY_CAP + 20; i += 1) {
  bounded = strokeReducer(bounded, {
    type: "commit",
    command: addStrokeCommand(rectStroke({ id: `bounded-${i}` })),
  });
}
equal("T-HIST-10 history is capped", bounded.undo.length, HISTORY_CAP);

/* --------------------------------------------------------------- report */

if (failures.length > 0) {
  console.error(`FAILED ${failures.length}/${passed + failures.length}`);
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`canvas geometry/history self-check: ${passed}/${passed} assertions passed`);
}
