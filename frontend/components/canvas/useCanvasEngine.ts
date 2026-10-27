"use client";

/**
 * Doc 07 §1.3 / §8 / §9 / §13 — all canvas state and side effects.
 *
 * `AnnotationCanvas` is a thin composition over this hook: three canvases, a
 * chrome column, and an a11y layer. Keeping the engine here means the render
 * component stays declarative and each file stays small.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearSnapshot,
  createAutosave,
  loadSnapshot,
  readSnapshotJson,
  subscribeStorage,
  type Autosave,
  type RestoreResult,
} from "@/lib/canvas/autosave";
import {
  DEFAULT_ANNOTATION_COLOR,
  defaultBlurStrength,
  defaultFontSize,
  defaultStrokeWidth,
  defaultWrapWidth,
  styleForTool,
} from "@/lib/canvas/defaults";
import { createEmptyDocument, makeId, nextLabel } from "@/lib/canvas/document";
import { CanvasError, toCanvasError } from "@/lib/canvas/errors";
import { checkLegibility, rasteriseExport } from "@/lib/canvas/export";
import { disposeBitmap, loadBitmap } from "@/lib/canvas/image";
import { createMeasureFn } from "@/lib/canvas/render";
import type { MeasureFn } from "@/lib/canvas/geometry";
import {
  addStrokeCommand,
  canRedo,
  canUndo,
  createStrokeState,
  deleteStrokesCommand,
  duplicateStrokes,
  moveStrokesCommand,
  redoLabel,
  replaceTopCommand,
  setLegendCommand,
  strokeReducer,
  translateStroke,
  undoLabel,
  type CanvasCommand,
  type StrokeState,
} from "@/lib/canvas/strokes";
import { TOOL_META, type EditorTool } from "@/lib/canvas/tools";
import { uploadAnnotation } from "@/lib/canvas/upload";
import {
  MAX_TEXT_CHARS,
  type CanvasDocument,
  type ExportResult,
  type Hex,
  type LegendItem,
  type Point,
  type Stroke,
  type StrokeStyle,
} from "@/lib/canvas/types";
import { createScene, type Scene } from "./scene";
import { useCanvasKeyboard } from "./useCanvasKeyboard";
import { useCanvasRenderer } from "./useCanvasRenderer";
import { useCanvasView, useNonPassiveWheel } from "./useCanvasView";
import { useInteraction } from "./useInteraction";
import { describeForLegend, mergeNudge } from "./legend";

export interface TextDraft {
  anchor: Point;
  box: Point;
  value: string;
}

export interface EngineInput {
  taskId: string;
  sourceAssetId: string;
  sourceUrl: string;
  initialDocument?: CanvasDocument;
  reviewMode: boolean;
  onExport?: (result: ExportResult) => void;
  onError?: (error: CanvasError) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function useCanvasEngine(input: EngineInput) {
  const { taskId, sourceAssetId, sourceUrl, initialDocument, reviewMode } = input;
  const measure: MeasureFn = useMemo(() => createMeasureFn(), []);
  const initialWidth = defaultStrokeWidth(initialDocument?.imageNaturalSize.w ?? 1920);

  const [doc, setDoc] = useState<CanvasDocument>(
    () => initialDocument ?? createEmptyDocument(sourceAssetId, { w: 1, h: 1 }),
  );
  const [tool, setTool] = useState<EditorTool>("select");
  const [color, setColor] = useState<Hex>(DEFAULT_ANNOTATION_COLOR);
  const [width, setWidth] = useState(initialWidth);
  const [opacity, setOpacity] = useState(1);
  const [blurMode, setBlurMode] = useState<"pixelate" | "blur">("pixelate");
  const [blurStrength, setBlurStrength] = useState(defaultBlurStrength(1920, "pixelate"));
  const [fontSize, setFontSize] = useState(defaultFontSize(initialDocument?.imageNaturalSize.w ?? 1920));
  const [visionMode, setVisionMode] = useState(true);
  const [legendEnabled, setLegendEnabled] = useState(initialDocument?.legend?.enabled ?? false);
  const [legendText, setLegendText] = useState<LegendItem[]>(initialDocument?.legend?.items ?? []);
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [alert, setAlert] = useState<string | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const [viewVersion, setViewVersion] = useState(0);

  const historyRef = useRef<StrokeState>(createStrokeState(doc));
  const sceneRef = useRef<Scene>(createScene({ doc, visionMode, showLegend: legendEnabled, reviewMode }));
  const imageRef = useRef<ImageBitmap | null>(null);
  const autosaveRef = useRef<Autosave | null>(null);
  const restoreCheckedRef = useRef(false);

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  // Props are mirrored into refs so the effects below never re-run when Doc 06
  // passes a fresh inline callback on every render.
  const onErrorRef = useRef(input.onError);
  const onExportRef = useRef(input.onExport);
  const onDirtyRef = useRef(input.onDirtyChange);
  onErrorRef.current = input.onError;
  onExportRef.current = input.onExport;
  onDirtyRef.current = input.onDirtyChange;

  const reportError = useCallback((error: unknown) => {
    const canvasError = toCanvasError(error);
    setAlert(canvasError.message);
    onErrorRef.current?.(canvasError);
  }, []);

  const renderer = useCanvasRenderer(sceneRef);
  const view = useCanvasView(sceneRef, renderer.invalidate, () => setViewVersion((n) => n + 1));
  useNonPassiveWheel(renderer.overlayRef, view.onWheel);

  /* ---------------------------------------------------------- image load */

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const scene = sceneRef.current;
    scene.imageStatus = "loading";
    renderer.invalidate("base");

    loadBitmap(sourceUrl, controller.signal)
      .then((loaded) => {
        if (cancelled) {
          disposeBitmap(loaded.bitmap);
          return;
        }
        disposeBitmap(imageRef.current);
        imageRef.current = loaded.bitmap;
        scene.image = loaded.bitmap;
        scene.imageStatus = "ready";
        scene.doc = { ...scene.doc, imageNaturalSize: initialDocument?.imageNaturalSize ?? loaded.size };
        setDoc((prev) => ({ ...prev, imageNaturalSize: initialDocument?.imageNaturalSize ?? loaded.size }));
        renderer.refit();
        setViewVersion((n) => n + 1);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        scene.imageStatus = "error";
        scene.image = null;
        renderer.invalidate("base");
        if (!(error instanceof DOMException && error.name === "AbortError")) reportError(error);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `renderer`/`initialDocument` are stable for the life of a source asset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl, reportError]);

  useEffect(() => {
    return () => {
      disposeBitmap(imageRef.current);
      imageRef.current = null;
      sceneRef.current.image = null;
    };
  }, []);

  /* ------------------------------------------------------------ history */

  const commitCommand = useCallback((command: CanvasCommand) => {
    const next = strokeReducer(historyRef.current, { type: "commit", command });
    historyRef.current = next;
    setDoc(next.doc);
    setDirty(true);
  }, []);

  const commitStroke = useCallback(
    (stroke: Stroke) => {
      commitCommand(addStrokeCommand(stroke));
      const total = historyRef.current.doc.strokes.length;
      announce(`${describeCommit(stroke)} added. ${total} annotation${total === 1 ? "" : "s"} total.`);
    },
    [announce, commitCommand],
  );

  const replaceStrokes = useCallback(
    (pairs: Array<{ prev: Stroke; next: Stroke }>) => {
      const command = moveStrokesCommand(pairs);
      if (command) commitCommand(command);
    },
    [commitCommand],
  );

  const deleteStrokes = useCallback(
    (ids: string[]) => {
      const command = deleteStrokesCommand(historyRef.current.doc, ids);
      if (!command) return;
      commitCommand(command);
      setSelectionIds((prev) => prev.filter((id) => !ids.includes(id)));
      announce(`${ids.length} annotation${ids.length === 1 ? "" : "s"} deleted.`);
    },
    [announce, commitCommand],
  );

  const undo = useCallback(() => {
    const before = historyRef.current;
    const next = strokeReducer(before, { type: "undo" });
    if (next === before) return;
    historyRef.current = next;
    setDoc(next.doc);
    setDirty(true);
    announce(`Undone: ${undoLabel(before) ?? "last action"}.`);
  }, [announce]);

  const redo = useCallback(() => {
    const before = historyRef.current;
    const next = strokeReducer(before, { type: "redo" });
    if (next === before) return;
    historyRef.current = next;
    setDoc(next.doc);
    setDirty(true);
    announce(`Redone: ${redoLabel(before) ?? "last action"}.`);
  }, [announce]);

  /* ----------------------------------------------------------- autosave */

  useEffect(() => {
    const autosave = createAutosave({ taskId, onError: reportError });
    autosaveRef.current = autosave;
    return () => {
      autosave.flush();
      autosave.dispose();
      autosaveRef.current = null;
    };
  }, [reportError, taskId]);

  useEffect(() => {
    if (dirty) autosaveRef.current?.schedule(doc);
  }, [dirty, doc]);

  useEffect(() => {
    onDirtyRef.current?.(dirty);
  }, [dirty]);

  useEffect(() => {
    const flush = () => {
      autosaveRef.current?.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  /* ------------------------------------------------------------- restore */

  useEffect(() => {
    if (restoreCheckedRef.current || initialDocument) return;
    restoreCheckedRef.current = true;
    const result = loadSnapshot(taskId, sourceAssetId);
    if (result.error) {
      reportError(result.error);
      return;
    }
    if (result.outcome === "ok" || result.outcome === "stale") {
      setRestored(result);
      if (result.outcome === "ok" && result.doc) {
        historyRef.current = createStrokeState(result.doc);
        setDoc(result.doc);
        setDirty(true);
      }
    }
  }, [initialDocument, reportError, sourceAssetId, taskId]);

  useEffect(
    () =>
      subscribeStorage(taskId, (foreign) => {
        if (foreign) announce("Another tab saved a draft for this task.");
      }),
    [announce, taskId],
  );

  const restoreDraft = useCallback(() => {
    if (!restored?.doc) return;
    historyRef.current = createStrokeState(restored.doc);
    setDoc(restored.doc);
    setDirty(true);
    setRestored(null);
    announce("Draft restored.");
  }, [announce, restored]);

  const discardDraft = useCallback(() => {
    clearSnapshot(taskId);
    const empty = createEmptyDocument(sourceAssetId, doc.imageNaturalSize);
    historyRef.current = createStrokeState(empty);
    setDoc(empty);
    setDirty(false);
    setRestored(null);
    announce("Draft discarded.");
  }, [announce, doc.imageNaturalSize, sourceAssetId, taskId]);

  /* ------------------------------------------------------ scene projection */

  useEffect(() => {
    const scene = sceneRef.current;
    scene.doc = doc;
    scene.visionMode = visionMode;
    scene.showLegend = legendEnabled;
    scene.reviewMode = reviewMode;
    renderer.invalidate("all");
  }, [doc, legendEnabled, renderer, reviewMode, visionMode]);

  useEffect(() => {
    sceneRef.current.selection = new Set(selectionIds);
    renderer.invalidate("overlay");
  }, [renderer, selectionIds]);

  /* ---------------------------------------------------------- keyboard */

  const selectAll = useCallback(() => {
    setSelectionIds(doc.strokes.map((s) => s.id));
    announce(`All ${doc.strokes.length} annotations selected.`);
  }, [announce, doc.strokes]);

  const duplicate = useCallback(() => {
    if (reviewMode) return;
    const copies = duplicateStrokes(historyRef.current.doc, selectionIds);
    if (copies.length === 0) return;
    copies.forEach((stroke) => commitCommand(addStrokeCommand(stroke)));
    setSelectionIds(copies.map((s) => s.id));
    announce(`${copies.length} annotation${copies.length === 1 ? "" : "s"} duplicated.`);
  }, [announce, commitCommand, reviewMode, selectionIds]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const scene = sceneRef.current;
      const moving = scene.doc.strokes.filter((s) => scene.selection.has(s.id));
      if (moving.length === 0) return;
      const command = moveStrokesCommand(
        moving.map((s) => ({ prev: s, next: translateStroke(s, dx, dy) })),
      );
      if (!command) return;
      const merged = mergeNudge(historyRef.current, command, Date.now());
      if (merged) {
        const next = replaceTopCommand(historyRef.current, merged);
        historyRef.current = next;
        setDoc(next.doc);
        setDirty(true);
        return;
      }
      commitCommand(command);
    },
    [commitCommand],
  );

  const style: StrokeStyle = useMemo(
    () => styleForTool(tool, doc.imageNaturalSize, { color, width, opacity }),
    [color, doc.imageNaturalSize, opacity, tool, width],
  );

  const requestText = useCallback(
    (anchor: Point, box: Point) => {
      if (reviewMode) return;
      setTextDraft({ anchor, box, value: "" });
    },
    [reviewMode],
  );

  const interaction = useInteraction({
    sceneRef,
    measure,
    tool,
    style,
    blurMode,
    blurStrength,
    reviewMode,
    invalidate: renderer.invalidate,
    commitStroke,
    deleteStrokes,
    replaceStrokes,
    requestText,
    announce,
    onSelect: setSelectionIds,
    restoreDoc: () => {
      sceneRef.current.doc = historyRef.current.doc;
      renderer.invalidate("all");
    },
  });

  const commitKeyboardStroke = useCallback(
    (from: Point, to: Point, alt: boolean) => {
      if (reviewMode) return;
      const rect = {
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        w: Math.abs(to.x - from.x),
        h: Math.abs(to.y - from.y),
      };
      if (rect.w < 2 || rect.h < 2) {
        announce("Region too small.");
        return;
      }
      if (tool === "text") {
        setTextDraft({ anchor: from, box: to, value: "" });
        return;
      }
      commitStroke(buildKeyboardStroke({ tool, from, to, rect, style, doc, alt, blurMode, blurStrength }));
    },
    [announce, blurMode, blurStrength, commitStroke, doc, reviewMode, style, tool],
  );

  const keyboard = useCanvasKeyboard({
    sceneRef,
    tool,
    setTool,
    reviewMode,
    width,
    setWidth,
    fontSize,
    setFontSize,
    onUndo: undo,
    onRedo: redo,
    onDelete: () => deleteStrokes(selectionIds),
    onSelectAll: selectAll,
    onDuplicate: duplicate,
    onNudge: nudge,
    onCommitKeyboardStroke: commitKeyboardStroke,
    onZoomIn: view.zoomIn,
    onZoomOut: view.zoomOut,
    onZoomReset: view.reset,
    onSelectNone: () => setSelectionIds([]),
    onCancelGesture: () => {
      interaction.cancel();
      sceneRef.current.keyboardCursor = null;
      renderer.invalidate("overlay");
    },
    announce,
  });

  /* ------------------------------------------------------------- legend */

  const legendItems = useMemo<LegendItem[]>(() => {
    const labelled = doc.strokes.filter((s): s is Stroke & { label: number } => typeof s.label === "number");
    return labelled
      .map((stroke) => ({
        label: stroke.label,
        text: legendText.find((item) => item.label === stroke.label)?.text || describeForLegend(stroke),
      }))
      .sort((a, b) => a.label - b.label);
  }, [doc.strokes, legendText]);

  useEffect(() => {
    sceneRef.current.doc = { ...sceneRef.current.doc, legend: { enabled: legendEnabled, items: legendItems } };
    renderer.invalidate("ink");
  }, [legendEnabled, legendItems, renderer]);

  const toggleLegend = useCallback(
    (enabled: boolean) => {
      setLegendEnabled(enabled);
      commitCommand(setLegendCommand(doc.legend, { enabled, items: legendItems }));
    },
    [commitCommand, doc.legend, legendItems],
  );

  const setLegendItemText = useCallback((label: number, text: string) => {
    setLegendText((prev) =>
      [...prev.filter((item) => item.label !== label), { label, text }].sort((a, b) => a.label - b.label),
    );
  }, []);

  /* ------------------------------------------------------------- export */

  const exportPng = useCallback(async () => {
    if (reviewMode || busy) return;
    setBusy(true);
    setAlert(null);
    try {
      const warnings = checkLegibility(doc, measure);
      const raster = await rasteriseExport({
        doc,
        image: imageRef.current,
        measure,
        visionMode,
        showLegend: legendEnabled,
      });
      if (raster.fontClamped || warnings.some((w) => w.code === "SMALL_TEXT")) {
        announce("Some labels were enlarged for legibility.");
      }
      const result = await uploadAnnotation({ taskId, doc, raster });
      setExportedPath(result.asset.absolute_path);
      setDirty(false);
      clearSnapshot(taskId);
      onExportRef.current?.(result);
      announce(`Annotation exported. ${Math.max(1, Math.round(result.byte_size / 1024))} KB uploaded.`);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }, [announce, busy, doc, legendEnabled, measure, reportError, reviewMode, taskId, visionMode]);

  const copyPath = useCallback(async () => {
    if (!exportedPath) return;
    try {
      await navigator.clipboard.writeText(exportedPath);
      announce("Path copied.");
    } catch (error) {
      reportError(new CanvasError("INTERNAL_ERROR", "Clipboard unavailable", { cause: error }));
    }
  }, [announce, exportedPath, reportError]);

  /* --------------------------------------------------------------- text */

  const commitText = useCallback(
    (value: string) => {
      const draft = textDraft;
      setTextDraft(null);
      if (!draft) return;
      const trimmed = value.trim().slice(0, MAX_TEXT_CHARS);
      if (trimmed.length === 0) return;
      commitStroke({
        id: makeId(),
        tool: "text",
        style: { ...style, dash: null },
        createdAt: Date.now(),
        label: nextLabel(doc),
        anchor: draft.anchor,
        box: draft.box,
        text: trimmed,
        fontSize,
        wrapWidth: defaultWrapWidth(doc.imageNaturalSize),
      });
    },
    [commitStroke, doc, fontSize, style, textDraft],
  );

  /* ------------------------------------------------------------ reorder */

  const reorder = useCallback(
    (direction: 1 | -1) => {
      if (reviewMode || selectionIds.length === 0) return;
      const strokes = historyRef.current.doc.strokes;
      const id = selectionIds[selectionIds.length - 1];
      const current = strokes.findIndex((s) => s.id === id);
      if (current === -1) return;
      const target = Math.min(Math.max(current + direction, 0), strokes.length - 1);
      if (target === current) return;
      commitCommand({ kind: "reorder", label: "reorder stroke", id, from: current, to: target });
    },
    [commitCommand, reviewMode, selectionIds],
  );

  const viewJson = useCallback(() => {
    const raw = readSnapshotJson(taskId);
    if (raw) announce(raw.slice(0, 400));
  }, [announce, taskId]);

  const zoomPercent = useMemo(() => {
    const scene = sceneRef.current;
    void viewVersion;
    return Math.round((scene.view.scale / Math.max(scene.fit, 1e-6)) * 100);
  }, [viewVersion]);

  const cursorStyle = buildCursor(tool, reviewMode, sceneRef.current.imageStatus, sceneRef.current.spacePan);

  return {
    // projection
    sceneRef,
    renderer,
    view,
    measure,
    interaction,
    keyboard,
    // document
    doc,
    dirty,
    busy,
    style,
    selectionIds,
    setSelectionIds,
    // tool state
    tool,
    setTool,
    color,
    setColor,
    width,
    setWidth,
    opacity,
    setOpacity,
    blurMode,
    setBlurMode,
    blurStrength,
    setBlurStrength,
    fontSize,
    setFontSize,
    visionMode,
    setVisionMode,
    // legend
    legendEnabled,
    legendItems,
    toggleLegend,
    setLegendItemText,
    // status
    announcement,
    alert,
    exportedPath,
    textDraft,
    restored,
    viewVersion,
    // history
    canUndo: canUndo(historyRef.current),
    canRedo: canRedo(historyRef.current),
    undoText: undoLabel(historyRef.current),
    redoText: redoLabel(historyRef.current),
    undo,
    redo,
    deleteSelection: () => deleteStrokes(selectionIds),
    duplicateSelection: duplicate,
    selectAll,
    bringForward: () => reorder(1),
    sendBackward: () => reorder(-1),
    // text
    commitText,
    cancelText: () => setTextDraft(null),
    // export
    exportPng,
    copyPath,
    // restore
    restoreDraft,
    discardDraft,
    viewJson,
    // image
    imageStatus: sceneRef.current.imageStatus,
    // derived
    zoomPercent,
    cursorStyle,
    toolLabel: TOOL_META[tool].ariaLabel,
  };
}

function buildCursor(
  tool: EditorTool,
  reviewMode: boolean,
  status: Scene["imageStatus"],
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

export type CanvasEngine = ReturnType<typeof useCanvasEngine>;

function describeCommit(stroke: Stroke): string {
  const noun = TOOL_META[
    stroke.tool === "freehand" ? "pen" : stroke.tool === "highlight" ? "highlight" : stroke.tool
  ].name;
  return typeof stroke.label === "number" ? `${noun} [${stroke.label}]` : noun;
}

function buildKeyboardStroke(args: {
  tool: EditorTool;
  from: Point;
  to: Point;
  rect: { x: number; y: number; w: number; h: number };
  style: StrokeStyle;
  doc: CanvasDocument;
  alt: boolean;
  blurMode: "pixelate" | "blur";
  blurStrength: number;
}): Stroke {
  const label = args.alt ? undefined : nextLabel(args.doc);
  const base = { id: makeId(), style: { ...args.style, dash: null }, createdAt: Date.now() };
  switch (args.tool) {
    case "arrow":
    case "line":
      return {
        ...base,
        tool: args.tool,
        from: args.from,
        to: args.to,
        ...(label === undefined ? {} : { label }),
      };
    case "blur":
      return { ...base, tool: "blur", rect: args.rect, mode: args.blurMode, strength: args.blurStrength };
    case "highlight":
      return { ...base, tool: "highlight", rect: args.rect, style: { ...base.style, opacity: 0.28 } };
    case "pen":
      return { ...base, tool: "freehand", points: [args.from, args.to] };
    default:
      return { ...base, tool: "rect", rect: args.rect, radius: 0, ...(label === undefined ? {} : { label }) };
  }
}
