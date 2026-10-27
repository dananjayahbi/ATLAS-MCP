/**
 * Doc 07 §15.1 — T-DOC-01/02/03 assertions as pure functions.
 *
 * Kept framework-free (no vitest import) so the same checks can be driven by
 * `document.test.ts` in CI and by a plain Node run for a quick local smoke.
 */
import {
  createEmptyDocument,
  deserialiseDocument,
  migrate,
  nextLabel,
  restoreDocument,
  sanitiseDocument,
  serialiseDocument,
} from "../document";
import { CanvasError } from "../errors";
import {
  CANVAS_DOC_VERSION,
  MAX_STROKES,
  MAX_STROKE_POINTS,
  MAX_TEXT_CHARS,
  MIN_FONT_SIZE,
  MIN_STROKE_WIDTH,
  type CanvasDocument,
  type RectStroke,
  type Stroke,
  type TextStroke,
} from "../types";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

function rectStroke(overrides: Partial<RectStroke> = {}): RectStroke {
  return {
    id: "s1",
    tool: "rect",
    style: { color: "#FF2D55", width: 5, opacity: 1, dash: null },
    createdAt: 1_700_000_000_000,
    label: 1,
    rect: { x: 10, y: 20, w: 100, h: 50 },
    radius: 0,
    ...overrides,
  };
}

function textStroke(overrides: Partial<TextStroke> = {}): TextStroke {
  return {
    id: "t1",
    tool: "text",
    style: { color: "#00F2FE", width: 4, opacity: 1, dash: null },
    createdAt: 1_700_000_000_001,
    label: 2,
    anchor: { x: 300, y: 400 },
    box: { x: 330, y: 320 },
    text: "expiry banner covers the token",
    fontSize: 21,
    wrapWidth: 280,
    ...overrides,
  };
}

export function sampleDoc(): CanvasDocument {
  const doc = createEmptyDocument("asset-uuid", { w: 4320, h: 2880 });
  return {
    ...doc,
    strokes: [rectStroke(), textStroke()],
    crop: { rect: { x: 100, y: 100, w: 3000, h: 2000 } },
    legend: {
      enabled: true,
      items: [
        { label: 1, text: "banner" },
        { label: 2, text: "token" },
      ],
    },
  };
}

export function runDocumentChecks(): CheckResult[] {  const results: CheckResult[] = [];
  const check = (name: string, fn: () => boolean | string): void => {
    try {
      const outcome = fn();
      if (outcome === true) results.push({ name, ok: true });
      else results.push({ name, ok: false, detail: String(outcome) });
    } catch (error) {
      results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  check("T-DOC-01 serialise→deserialise is deep-equal", () => {
    const doc = sampleDoc();
    const round = deserialiseDocument(serialiseDocument(doc));
    if (!round) return "deserialise returned null";
    if (!deepEqual(doc, round)) {
      return `mismatch\n  before ${JSON.stringify(doc)}\n  after  ${JSON.stringify(round)}`;
    }
    return true;
  });

  check("T-DOC-01b JSON.parse(JSON.stringify(doc)) deep-equals doc", () => {
    const doc = sampleDoc();
    const nested = JSON.parse(JSON.stringify(doc)) as unknown;
    return JSON.stringify(nested) === JSON.stringify(doc) || "not deep-equal";
  });

  check("T-DOC-01c sanitise is idempotent (byte-identical on re-run)", () => {
    const doc = sampleDoc();
    const once = serialiseDocument(doc);
    const twice = serialiseDocument(sanitiseDocument(JSON.parse(once) as CanvasDocument));
    return once === twice || "sanitise is not idempotent";
  });

  check("T-DOC-02 migrate upgrades a v0 payload (pen→freehand, thickness→style.width)", () => {
    const legacy = {
      version: 0,
      sourceAssetId: "asset-uuid",
      imageNaturalSize: { w: 1280, h: 720 },
      strokes: [
        {
          id: "old",
          tool: "pen",
          color: "#FF2D55",
          thickness: 6,
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      ],
    };
    const migrated = migrate(legacy);
    if (!migrated) return "migrate returned null";
    if (migrated.version !== CANVAS_DOC_VERSION) return `version ${migrated.version}`;
    const stroke = migrated.strokes[0];
    if (!stroke) return "stroke dropped";
    if (stroke.tool !== "freehand") return `tool ${stroke.tool}`;
    return stroke.style.width === 6 || `width ${stroke.style.width}`;
  });

  check("T-DOC-02b unknown tool is dropped", () => {
    const doc = sampleDoc();
    const bogus = {
      ...doc,
      strokes: [...doc.strokes, { id: "x", tool: "laser", style: {}, createdAt: 0 }],
    };
    const sanitised = sanitiseDocument(bogus as unknown as CanvasDocument);
    return sanitised.strokes.length === doc.strokes.length || `len ${sanitised.strokes.length}`;
  });

  check("T-DOC-02c version > current is refused with CANVAS_RESTORE_VERSION", () => {
    const future = JSON.stringify({ ...sampleDoc(), version: CANVAS_DOC_VERSION + 1 });
    if (deserialiseDocument(future) !== null) return "deserialise accepted a future version";
    const outcome = restoreDocument(future);
    if (!(outcome.error instanceof CanvasError)) return "restoreDocument reported no error";
    return outcome.error.code === "CANVAS_RESTORE_VERSION" || `code ${outcome.error.code}`;
  });

  check("T-DOC-03 sanitise clamps width, font size, points and text", () => {
    const doc = sampleDoc();
    const thin = rectStroke({ style: { color: "#FF2D55", width: 0.2, opacity: 1, dash: null } });
    const tiny = textStroke({ fontSize: 4, text: "x".repeat(MAX_TEXT_CHARS + 40) });
    const long: Stroke = {
      id: "f1",
      tool: "freehand",
      style: { color: "#FF2D55", width: 5, opacity: 1, dash: null },
      createdAt: 0,
      points: Array.from({ length: MAX_STROKE_POINTS + 500 }, (_, i) => ({ x: i, y: i })),
    };
    const result = sanitiseDocument({ ...doc, strokes: [thin, tiny, long] });
    const [r, t, f] = result.strokes;
    if (r.tool !== "rect") return "rect dropped";
    if (r.style.width < MIN_STROKE_WIDTH) return `width ${r.style.width}`;
    if (t.tool !== "text") return "text dropped";
    if (t.fontSize < MIN_FONT_SIZE) return `fontSize ${t.fontSize}`;
    if (t.text.length > MAX_TEXT_CHARS) return `text ${t.text.length}`;
    if (f.tool !== "freehand") return "freehand dropped";
    if (f.points.length > MAX_STROKE_POINTS) return `points ${f.points.length}`;
    return true;
  });

  check("T-DOC-03b stroke count is capped at MAX_STROKES", () => {
    const doc = sampleDoc();
    const strokes = Array.from({ length: MAX_STROKES + 25 }, (_, i) => rectStroke({ id: `r${i}` }));
    const sanitised = sanitiseDocument({ ...doc, strokes });
    return sanitised.strokes.length === MAX_STROKES || `len ${sanitised.strokes.length}`;
  });

  check("T-DOC-03c out-of-range coordinates are clamped", () => {
    const doc = sampleDoc();
    const wild = rectStroke({ rect: { x: -1e9, y: 1e9, w: 1e9, h: 1e9 } });
    const stroke = sanitiseDocument({ ...doc, strokes: [wild] }).strokes[0];
    if (!stroke || stroke.tool !== "rect") return "stroke dropped";
    if (stroke.rect.x < -100_000) return `x ${stroke.rect.x}`;
    if (stroke.rect.w > doc.imageNaturalSize.w) return `w ${stroke.rect.w}`;
    if (stroke.rect.h > doc.imageNaturalSize.h) return `h ${stroke.rect.h}`;
    return true;
  });

  check("§10.6 nextLabel leaves gaps (identity, not rank)", () => {
    const value = nextLabel(sampleDoc());
    return value === 3 || `label ${value}`;
  });

  check("legend rows are pruned to surviving labels", () => {
    const doc = sampleDoc();
    const pruned = sanitiseDocument({ ...doc, strokes: [doc.strokes[0]] });
    const count = pruned.legend?.items.length ?? -1;
    return count === 1 || `items ${count}`;
  });

  check("§4.9 a crop under 64 px is rejected", () => {
    const doc = sampleDoc();
    const tiny = sanitiseDocument({ ...doc, crop: { rect: { x: 0, y: 0, w: 2, h: 2 } } });
    return tiny.crop === null || "crop survived";
  });

  check("duplicate ids are repaired", () => {
    const doc = sampleDoc();
    const twins = sanitiseDocument({ ...doc, strokes: [rectStroke({ id: "dup" }), textStroke({ id: "dup" })] });
    if (twins.strokes.length !== 2) return "stroke dropped";
    return twins.strokes[0].id !== twins.strokes[1].id || "ids still collide";
  });

  return results;
}

/** Structural equality — key order must not matter for `T-DOC-01`. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => deepEqual(left[key], right[key]));
}
