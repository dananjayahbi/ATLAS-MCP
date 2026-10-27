// lib/canvas/errors.ts
var CANVAS_ERROR_MESSAGES = {
  IMAGE_FETCH_FAILED: "Could not load the screenshot.",
  IMAGE_DECODE_FAILED: "The screenshot file is corrupt.",
  IMAGE_TOO_LARGE: "Image exceeds 40 MP; a proxy will be used.",
  IMAGE_UNSUPPORTED_TYPE: "Unsupported image format.",
  CANVAS_AUTOSAVE_FULL: "Local recovery storage is full; export to save.",
  CANVAS_RESTORE_VERSION: "Recovered draft is from a newer version.",
  EXPORT_ENCODE_FAILED: "Could not encode the PNG.",
  EXPORT_TAINTED: "Image is cross-origin; export blocked.",
  EXPORT_TOO_LARGE: "Export exceeds the 25 MB cap; crop or export at 75 %.",
  EXPORT_HASH_UNAVAILABLE: "Hashing unavailable; dedupe skipped.",
  EXPORT_FONT_CLAMPED: "Some labels were enlarged for legibility.",
  UPLOAD_NETWORK: "Offline \u2014 annotation queued.",
  PAYLOAD_TOO_LARGE: "Upload exceeds the 25 MB cap.",
  UNSUPPORTED_MEDIA_TYPE: "Server rejected image/png.",
  STORAGE_WRITE_FAILED: "Disk write failed \u2014 retrying.",
  PATH_OUT_OF_SCOPE: "Storage root misconfigured.",
  TASK_NOT_FOUND: "Task no longer exists.",
  BACKEND_UNAVAILABLE: "Backend unavailable \u2014 queued.",
  INTERNAL_ERROR: "Unexpected server error."
};
var CANVAS_ERROR_RETRYABLE = {
  IMAGE_FETCH_FAILED: true,
  IMAGE_DECODE_FAILED: true,
  IMAGE_TOO_LARGE: false,
  IMAGE_UNSUPPORTED_TYPE: false,
  CANVAS_AUTOSAVE_FULL: false,
  CANVAS_RESTORE_VERSION: false,
  EXPORT_ENCODE_FAILED: true,
  EXPORT_TAINTED: false,
  EXPORT_TOO_LARGE: false,
  EXPORT_HASH_UNAVAILABLE: false,
  EXPORT_FONT_CLAMPED: false,
  UPLOAD_NETWORK: true,
  PAYLOAD_TOO_LARGE: false,
  UNSUPPORTED_MEDIA_TYPE: false,
  STORAGE_WRITE_FAILED: true,
  PATH_OUT_OF_SCOPE: false,
  TASK_NOT_FOUND: false,
  BACKEND_UNAVAILABLE: true,
  INTERNAL_ERROR: true
};
var CanvasError = class extends Error {
  code;
  status;
  requestId;
  detail;
  retryable;
  constructor(code, message, options = {}) {
    super(message ?? CANVAS_ERROR_MESSAGES[code]);
    this.name = "CanvasError";
    this.code = code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.detail = options.detail ?? null;
    this.retryable = CANVAS_ERROR_RETRYABLE[code];
    if (options.cause !== void 0) {
      this.cause = options.cause;
    }
  }
};

// lib/canvas/types.ts
var CANVAS_DOC_VERSION = 1;
var MAX_STROKES = 500;
var MAX_STROKE_POINTS = 2e3;
var MAX_RAW_POINTS = 2e4;
var MAX_TEXT_CHARS = 280;
var MIN_STROKE_WIDTH = 3;
var MAX_STROKE_WIDTH = 96;
var MIN_FONT_SIZE = 12;
var MAX_FONT_SIZE = 256;
function isLabellableTool(tool) {
  return tool === "rect" || tool === "arrow" || tool === "text";
}

// lib/canvas/document.ts
var SUPPORTED_TOOL_NAMES = [
  "rect",
  "arrow",
  "line",
  "freehand",
  "highlight",
  "blur",
  "text"
];
var MAX_COORDINATE = 1e5;
function createEmptyDocument(sourceAssetId, image) {
  return {
    version: CANVAS_DOC_VERSION,
    sourceAssetId,
    imageNaturalSize: { w: Math.max(1, Math.round(image.w)), h: Math.max(1, Math.round(image.h)) },
    strokes: [],
    crop: null,
    legend: { enabled: false, items: [] }
  };
}
function serialiseDocument(doc) {
  return JSON.stringify(sanitiseDocument(doc));
}
function deserialiseDocument(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return migrate(parsed);
}
function restoreDocument(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { doc: null, error: null };
  }
  if (isPlainObject(parsed) && typeof parsed.version === "number" && parsed.version > CANVAS_DOC_VERSION) {
    return { doc: null, error: new CanvasError("CANVAS_RESTORE_VERSION") };
  }
  return { doc: migrate(parsed), error: null };
}
function migrate(raw) {
  if (!isPlainObject(raw)) return null;
  const version = typeof raw.version === "number" ? raw.version : 0;
  if (version > CANVAS_DOC_VERSION) return null;
  const upgraded = version === 0 ? upgradeV0(raw) : raw;
  const doc = coerceDocument(upgraded);
  return doc ? sanitiseDocument(doc) : null;
}
function upgradeV0(raw) {
  const strokes = Array.isArray(raw.strokes) ? raw.strokes : [];
  const legacyToolMap = {
    pen: "freehand",
    freehand: "freehand",
    rect: "rect",
    arrow: "arrow",
    text: "text",
    blur: "blur",
    line: "line",
    highlight: "highlight"
  };
  const upgraded = strokes.map((entry) => {
    if (!isPlainObject(entry)) return entry;
    const tool = typeof entry.tool === "string" ? entry.tool : "";
    const next = { ...entry };
    next.tool = legacyToolMap[tool] ?? tool;
    const thickness = entry.thickness;
    if (typeof thickness === "number" && entry.style === void 0) {
      next.style = {
        color: typeof entry.color === "string" ? entry.color : "#FF2D55",
        width: thickness,
        opacity: 1
      };
    }
    delete next.thickness;
    return next;
  });
  return { ...raw, version: 1, strokes: upgraded };
}
function sanitiseDocument(doc) {
  const image = sanitiseSize(doc.imageNaturalSize);
  const strokes = dedupeIds(
    doc.strokes.map((s) => sanitiseStroke(s, image)).filter((s) => s !== null).slice(0, MAX_STROKES)
  );
  const crop = sanitiseCrop(doc.crop, image);
  return {
    version: CANVAS_DOC_VERSION,
    sourceAssetId: typeof doc.sourceAssetId === "string" ? doc.sourceAssetId : "",
    imageNaturalSize: image,
    strokes,
    crop,
    legend: sanitiseLegend(doc.legend, strokes)
  };
}
function sanitiseSize(size) {
  const w = clampNumber(size?.w, 1, MAX_COORDINATE, 1);
  const h = clampNumber(size?.h, 1, MAX_COORDINATE, 1);
  return { w: Math.round(w), h: Math.round(h) };
}
function sanitiseStroke(stroke, image) {
  if (!isPlainObject(stroke)) return null;
  const tool = typeof stroke.tool === "string" ? stroke.tool : "";
  if (!SUPPORTED_TOOL_NAMES.includes(tool)) return null;
  const base = sanitiseBase(stroke, tool);
  switch (tool) {
    case "rect": {
      const rect = sanitiseRect(stroke.rect, image);
      if (!rect) return null;
      return { ...base, tool: "rect", rect, radius: Math.max(0, clampNumber(stroke.radius, 0, 64, 0)) };
    }
    case "highlight": {
      const rect = sanitiseRect(stroke.rect, image);
      if (!rect) return null;
      return { ...base, tool: "highlight", rect };
    }
    case "blur": {
      const rect = sanitiseRect(stroke.rect, image);
      if (!rect) return null;
      return {
        ...base,
        tool: "blur",
        rect,
        mode: stroke.mode === "blur" ? "blur" : "pixelate",
        strength: clampNumber(stroke.strength, 1, 256, 8)
      };
    }
    case "line":
    case "arrow": {
      const from = sanitisePoint(stroke.from, image);
      const to = sanitisePoint(stroke.to, image);
      if (!from || !to) return null;
      return { ...base, tool, from, to };
    }
    case "freehand": {
      const raw = Array.isArray(stroke.points) ? stroke.points : [];
      const points = raw.slice(-MAX_RAW_POINTS).map((p) => sanitisePoint(p, image)).filter((p) => p !== null).slice(0, MAX_STROKE_POINTS);
      if (points.length === 0) return null;
      return { ...base, tool: "freehand", points };
    }
    case "text": {
      const anchor = sanitisePoint(stroke.anchor, image);
      const box = sanitisePoint(stroke.box, image);
      if (!anchor || !box) return null;
      const text = typeof stroke.text === "string" ? stroke.text.slice(0, MAX_TEXT_CHARS) : "";
      return {
        ...base,
        tool: "text",
        anchor,
        box,
        text,
        fontSize: clampNumber(stroke.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, 14),
        wrapWidth: clampNumber(stroke.wrapWidth, 40, MAX_COORDINATE, 320)
      };
    }
    default:
      return null;
  }
}
function sanitiseBase(stroke, tool) {
  const style = sanitiseStyle(stroke.style);
  const label = isLabellableTool(tool) ? sanitiseLabel(stroke.label) : void 0;
  const createdAt = clampNumber(stroke.createdAt, 0, Number.MAX_SAFE_INTEGER, 0);
  const base = {
    id: typeof stroke.id === "string" && stroke.id.length > 0 ? stroke.id : makeId(),
    style,
    createdAt
  };
  return label === void 0 ? base : { ...base, label };
}
function sanitiseStyle(style) {
  const record = isPlainObject(style) ? style : {};
  const color = typeof record.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(record.color) ? record.color : "#FF2D55";
  const dashRaw = Array.isArray(record.dash) ? record.dash : null;
  const dash = dashRaw ? dashRaw.filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) : null;
  return {
    color,
    width: clampNumber(record.width, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH, MIN_STROKE_WIDTH),
    opacity: clampNumber(record.opacity, 0.05, 1, 1),
    dash: dash && dash.length > 0 ? dash : null
  };
}
function sanitiseLabel(label) {
  if (typeof label !== "number" || !Number.isFinite(label) || label < 1) return void 0;
  return Math.min(Math.floor(label), 9999);
}
function sanitisePoint(point, image) {
  if (!isPlainObject(point)) return null;
  const x = point.x;
  const y = point.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: clampNumber(x, -MAX_COORDINATE, image.w + MAX_COORDINATE, 0),
    y: clampNumber(y, -MAX_COORDINATE, image.h + MAX_COORDINATE, 0)
  };
}
function sanitiseRect(rect, image) {
  if (!isPlainObject(rect)) return null;
  const { x, y, w, h } = rect;
  if ([x, y, w, h].some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  const width = clampNumber(w, 0, image.w, 0);
  const height = clampNumber(h, 0, image.h, 0);
  if (width <= 0 || height <= 0) return null;
  return {
    x: clampNumber(x, -MAX_COORDINATE, MAX_COORDINATE, 0),
    y: clampNumber(y, -MAX_COORDINATE, MAX_COORDINATE, 0),
    w: width,
    h: height
  };
}
function sanitiseCrop(crop, image) {
  if (!isPlainObject(crop) || !isPlainObject(crop.rect)) return null;
  const rect = sanitiseRect(crop.rect, image);
  if (!rect) return null;
  if (rect.w < 64 || rect.h < 64) return null;
  return { rect };
}
function sanitiseLegend(legend, strokes) {
  const enabled = isPlainObject(legend) ? legend.enabled === true : false;
  const rawItems = isPlainObject(legend) && Array.isArray(legend.items) ? legend.items : [];
  const known = new Set(
    strokes.map((s) => s.label).filter((l) => typeof l === "number")
  );
  const items = rawItems.filter((item) => isPlainObject(item) && typeof item.label === "number").map((item) => ({
    label: item.label,
    text: typeof item.text === "string" ? item.text.slice(0, MAX_TEXT_CHARS) : ""
  })).filter((item) => known.has(item.label)).sort((a, b) => a.label - b.label);
  return { enabled, items };
}
function dedupeIds(strokes) {
  const seen = /* @__PURE__ */ new Set();
  return strokes.map((stroke) => {
    if (!seen.has(stroke.id)) {
      seen.add(stroke.id);
      return stroke;
    }
    const id = makeId();
    seen.add(id);
    return { ...stroke, id };
  });
}
function coerceDocument(raw) {
  if (typeof raw.sourceAssetId !== "string") return null;
  if (!isPlainObject(raw.imageNaturalSize)) return null;
  const strokes = Array.isArray(raw.strokes) ? raw.strokes : [];
  return {
    version: typeof raw.version === "number" ? raw.version : CANVAS_DOC_VERSION,
    sourceAssetId: raw.sourceAssetId,
    imageNaturalSize: {
      w: Number(raw.imageNaturalSize.w),
      h: Number(raw.imageNaturalSize.h)
    },
    strokes,
    crop: isPlainObject(raw.crop) ? coerceCrop(raw.crop) : null,
    legend: isPlainObject(raw.legend) ? coerceLegend(raw.legend) : { enabled: false, items: [] }
  };
}
function coerceCrop(value) {
  if (!isPlainObject(value)) return null;
  return value;
}
function coerceLegend(value) {
  if (!isPlainObject(value)) return { enabled: false, items: [] };
  return value;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
var idCounter = 0;
function makeId() {
  idCounter += 1;
  const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
function nextLabel(doc) {
  return doc.strokes.reduce((max, s) => typeof s.label === "number" ? Math.max(max, s.label) : max, 0) + 1;
}

// lib/canvas/__tests__/document-checks.ts
function rectStroke(overrides = {}) {
  return {
    id: "s1",
    tool: "rect",
    style: { color: "#FF2D55", width: 5, opacity: 1, dash: null },
    createdAt: 17e11,
    label: 1,
    rect: { x: 10, y: 20, w: 100, h: 50 },
    radius: 0,
    ...overrides
  };
}
function textStroke(overrides = {}) {
  return {
    id: "t1",
    tool: "text",
    style: { color: "#00F2FE", width: 4, opacity: 1, dash: null },
    createdAt: 1700000000001,
    label: 2,
    anchor: { x: 300, y: 400 },
    box: { x: 330, y: 320 },
    text: "expiry banner covers the token",
    fontSize: 21,
    wrapWidth: 280,
    ...overrides
  };
}
function sampleDoc() {
  const doc = createEmptyDocument("asset-uuid", { w: 4320, h: 2880 });
  return {
    ...doc,
    strokes: [rectStroke(), textStroke()],
    crop: { rect: { x: 100, y: 100, w: 3e3, h: 2e3 } },
    legend: {
      enabled: true,
      items: [
        { label: 1, text: "banner" },
        { label: 2, text: "token" }
      ]
    }
  };
}
function runDocumentChecks() {
  const results2 = [];
  const check = (name, fn) => {
    try {
      const outcome = fn();
      if (outcome === true) results2.push({ name, ok: true });
      else results2.push({ name, ok: false, detail: String(outcome) });
    } catch (error) {
      results2.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  check("T-DOC-01 serialise\u2192deserialise is byte-identical", () => {
    const doc = sampleDoc();
    const round = deserialiseDocument(serialiseDocument(doc));
    if (!round) return "deserialise returned null";
    const a = JSON.stringify(doc);
    const b = JSON.stringify(round);
    return a === b || `mismatch
  before ${a}
  after  ${b}`;
  });
  check("T-DOC-01b JSON.parse(JSON.stringify(doc)) deep-equals doc", () => {
    const doc = sampleDoc();
    const nested = JSON.parse(JSON.stringify(doc));
    return JSON.stringify(nested) === JSON.stringify(doc) || "not deep-equal";
  });
  check("T-DOC-02 migrate upgrades a v0 payload (pen\u2192freehand, thickness\u2192style.width)", () => {
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
            { x: 3, y: 4 }
          ]
        }
      ]
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
      strokes: [...doc.strokes, { id: "x", tool: "laser", style: {}, createdAt: 0 }]
    };
    const sanitised = sanitiseDocument(bogus);
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
    const long = {
      id: "f1",
      tool: "freehand",
      style: { color: "#FF2D55", width: 5, opacity: 1, dash: null },
      createdAt: 0,
      points: Array.from({ length: MAX_STROKE_POINTS + 500 }, (_, i) => ({ x: i, y: i }))
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
    if (stroke.rect.x < -1e5) return `x ${stroke.rect.x}`;
    if (stroke.rect.w > doc.imageNaturalSize.w) return `w ${stroke.rect.w}`;
    if (stroke.rect.h > doc.imageNaturalSize.h) return `h ${stroke.rect.h}`;
    return true;
  });
  check("\xA710.6 nextLabel leaves gaps (identity, not rank)", () => {
    const value = nextLabel(sampleDoc());
    return value === 3 || `label ${value}`;
  });
  check("legend rows are pruned to surviving labels", () => {
    const doc = sampleDoc();
    const pruned = sanitiseDocument({ ...doc, strokes: [doc.strokes[0]] });
    const count = pruned.legend?.items.length ?? -1;
    return count === 1 || `items ${count}`;
  });
  check("\xA74.9 a crop under 64 px is rejected", () => {
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
  return results2;
}

// lib/canvas/__tests__/run-checks.mts
var results = runDocumentChecks();
for (const result of results) {
  const status = result.ok ? "PASS" : "FAIL";
  console.log(`${status}  ${result.name}${result.ok ? "" : ` \u2014 ${result.detail ?? ""}`}`);
}
var failed = results.filter((r) => !r.ok);
console.log(`
${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;
