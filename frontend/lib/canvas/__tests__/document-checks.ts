/**
 * Doc 07 §15.1 — self-check for `lib/canvas`. Framework-free, no DOM: the
 * modules under test are pure, so they run under plain `node` after bundling.
 *
 * Run with:
 *   node_modules\.bin\esbuild lib\canvas\__tests__\run-checks.mts \
 *     --bundle --platform=node --format=esm --outfile=lib\canvas\__tests__\checks.mjs
 *   node lib\canvas\__tests__\checks.mjs
 */
import {
  createEmptyDocument,
  deserialiseDocument,
  makeId,
  nextLabel,
  restoreDocument,
  serialiseDocument,
} from "../document";
import { CANVAS_DOC_VERSION, type CanvasDocument, type RectStroke } from "../types";

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

function rectStroke(overrides: Partial<RectStroke> = {}): RectStroke {
  return {
    id: makeId(),
    tool: "rect",
    rect: { x: 10, y: 20, w: 30, h: 40 },
    style: { color: "#FF3B30", width: 6, opacity: 1 },
    label: 1,
    createdAt: 1_000,
    ...overrides,
  };
}

function withStroke(stroke: RectStroke = rectStroke()): CanvasDocument {
  const base = createEmptyDocument("asset-1", { w: 1280, h: 720 });
  return { ...base, strokes: [stroke] };
}

/* ------------------------------------------------------------- document */

const empty = createEmptyDocument("asset-1", { w: 1280, h: 720 });
equal("T-DOC-1 empty doc carries current version", empty.version, CANVAS_DOC_VERSION);
equal("T-DOC-2 empty doc records natural size", empty.imageNaturalSize.w, 1280);

const doc = withStroke();
const parsed = JSON.parse(serialiseDocument(doc)) as CanvasDocument;
equal("T-DOC-3 serialise keeps version", parsed.version, CANVAS_DOC_VERSION);
equal("T-DOC-4 serialise keeps stroke count", parsed.strokes.length, 1);

const restored = deserialiseDocument(serialiseDocument(doc));
check("T-DOC-5 round-trip returns a document", restored !== null);
equal("T-DOC-6 round-trip preserves stroke id", restored?.strokes[0]?.id ?? null, doc.strokes[0].id);
equal("T-DOC-7 round-trip preserves tool", restored?.strokes[0]?.tool ?? null, "rect");

check("T-DOC-8 rejects malformed JSON", deserialiseDocument("{ not json") === null);
check(
  "T-DOC-9 rejects a future version",
  deserialiseDocument(JSON.stringify({ ...doc, version: CANVAS_DOC_VERSION + 1 })) === null,
);

const future = restoreDocument(JSON.stringify({ ...doc, version: CANVAS_DOC_VERSION + 1 }));
check("T-DOC-10 future version reports an error", future.error !== null && future.doc === null);

const outOfRange = deserialiseDocument(
  JSON.stringify({
    ...doc,
    strokes: [{ ...rectStroke(), rect: { x: -50_000, y: 1e12, w: 30, h: 40 } }],
  }),
);
const clampedStroke = outOfRange?.strokes[0];
check(
  "T-DOC-11 clamps non-finite / out-of-range coordinates",
  clampedStroke !== undefined &&
    clampedStroke.tool === "rect" &&
    Number.isFinite(clampedStroke.rect.x) &&
    Number.isFinite(clampedStroke.rect.y),
);

const legacy = deserialiseDocument(
  JSON.stringify({
    version: 0,
    sourceAssetId: "asset-1",
    imageNaturalSize: { w: 800, h: 600 },
    strokes: [{ id: "legacy-1", tool: "pen", points: [{ x: 1, y: 2 }], color: "#FF3B30", thickness: 4 }],
  }),
);
equal("T-DOC-12 migrates a v0 pen stroke to freehand", legacy?.strokes[0]?.tool ?? null, "freehand");

const duplicateIds = deserialiseDocument(
  JSON.stringify({ ...doc, strokes: [rectStroke({ id: "same" }), rectStroke({ id: "same" })] }),
);
check(
  "T-DOC-13 repairs duplicate stroke ids",
  duplicateIds !== null && duplicateIds.strokes[0]?.id !== duplicateIds.strokes[1]?.id,
);

equal("T-DOC-14 nextLabel starts at 1", nextLabel(createEmptyDocument("a", { w: 10, h: 10 })), 1);
equal("T-DOC-15 nextLabel follows the maximum", nextLabel(withStroke(rectStroke({ label: 4 }))), 5);

/* ------------------------------------------------------------- report */

if (failures.length > 0) {
  console.error(`FAILED ${failures.length}/${passed + failures.length}`);
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`canvas document self-check: ${passed}/${passed} assertions passed`);
}
