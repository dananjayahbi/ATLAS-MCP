"use client";

/**
 * Doc 07 §1.3 — the composition root. Only wiring lives here; every behaviour
 * sits in a focused hook: `useSourceImageRuntime` (§11.4), `usePersistence`
 * (§13), `useSceneProjection` (§2.3), `useCanvasHistory` (§8), `useToolState`
 * (§10), `useTextTool` (§4.6), `useInteraction` (§7), `useEngineKeyboard`
 * (§12), `useExport` (§9).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { createEmptyDocument } from "@/lib/canvas/document";
import type { CanvasError } from "@/lib/canvas/errors";
import { createMeasureFn, type MeasureFn } from "@/lib/canvas/render";
import { TOOL_META } from "@/lib/canvas/tools";
import type { CanvasDocument, ExportResult, Size } from "@/lib/canvas/types";
import { buildCursor } from "./cursor-style";
import { createScene, type Scene } from "./scene";
import { useCanvasHistory } from "./useCanvasHistory";
import { useCanvasRenderer } from "./useCanvasRenderer";
import { useCanvasView, useNonPassiveWheel } from "./useCanvasView";
import { useEngineKeyboard } from "./useEngineKeyboard";
import { useExport } from "./useExport";
import { useInteraction } from "./useInteraction";
import { useLegendState } from "./useLegendState";
import { useNotifications } from "./useNotifications";
import { usePersistence } from "./usePersistence";
import { useSceneProjection } from "./useSceneProjection";
import { useSelectionActions } from "./useSelectionActions";
import { useSourceImageRuntime } from "./useSourceImageRuntime";
import { useTextTool } from "./useTextTool";
import { useToolState } from "./useToolState";

export type { TextDraft } from "./useTextTool";

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

  /* ------------------------------------------------------- scene + history */

  const sceneRef = useRef<Scene>(
    createScene({
      doc: initialDocument ?? createEmptyDocument(sourceAssetId, { w: 1, h: 1 }),
      visionMode: true,
      showLegend: initialDocument?.legend?.enabled ?? false,
      reviewMode,
    }),
  );
  const imageRef = useRef<ImageBitmap | null>(null);
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [viewVersion, setViewVersion] = useState(0);

  const history = useCanvasHistory(sceneRef.current.doc, () => {});
  const { doc, dirty } = history;
  const docRef = useRef<CanvasDocument>(doc);
  docRef.current = doc;
  const getDoc = useCallback(() => docRef.current, []);

  const notify = useNotifications(
    { onError: input.onError, onDirtyChange: input.onDirtyChange },
    dirty,
  );
  const announce = notify.announce;
  history.setAnnouncer(announce);

  /* ------------------------------------------------------ renderer + view */

  const renderer = useCanvasRenderer(sceneRef);
  const { invalidate } = renderer;
  const bumpView = useCallback(() => setViewVersion((n) => n + 1), []);
  const view = useCanvasView(sceneRef, invalidate, bumpView);
  useNonPassiveWheel(renderer.overlayRef, view.onWheel);

  /* ------------------------------------------ image, autosave, projection */

  const runtime = useSourceImageRuntime({
    url: sourceUrl,
    initialDocument,
    imageRef,
    sceneRef,
    onError: notify.reportError,
    onLoaded: () => {
      renderer.refit();
      bumpView();
    },
  });
  const imageSize: Size = runtime.imageSize;

  const tools = useToolState({ imageSize, tool: "select", imageReady: runtime.imageReady });
  const legend = useLegendState({
    doc,
    initialEnabled: initialDocument?.legend?.enabled,
    initialItems: initialDocument?.legend?.items,
    getDoc,
    announce,
  });

  useSceneProjection({
    sceneRef,
    doc,
    selectionIds,
    visionMode: tools.visionMode,
    legendEnabled: legend.enabled,
    legendItems: legend.items,
    reviewMode,
    invalidate,
  });

  const persistence = usePersistence({
    taskId,
    sourceAssetId,
    initialDocument,
    doc,
    dirty,
    onError: notify.reportError,
    onAnnounce: announce,
    onRestore: history.replaceAll,
    onDiscard: history.replaceAll,
  });

  /* --------------------------------------------------- text + interaction */

  const text = useTextTool({
    getDoc,
    commitStroke: history.commitStroke,
    style: tools.style,
    fontSize: tools.fontSize,
    reviewMode,
  });

  const interaction = useInteraction({
    sceneRef,
    measure,
    tool: tools.tool,
    style: tools.style,
    blurMode: tools.blurMode,
    blurStrength: tools.blurStrength,
    reviewMode,
    invalidate,
    commitStroke: history.commitStroke,
    deleteStrokes: history.deleteStrokes,
    replaceStrokes: history.replaceStrokes,
    requestText: text.begin,
    announce,
    onSelect: setSelectionIds,
    restoreDoc: () => {
      sceneRef.current.doc = docRef.current;
      invalidate("all");
    },
  });

  const selection = useSelectionActions({
    history,
    getDoc,
    selectionIds,
    setSelectionIds,
    reviewMode,
    announce,
  });

  /* --------------------------------------------------- keyboard + export */

  const { keyboard, toggleLegend } = useEngineKeyboard({
    sceneRef,
    history,
    tools,
    text,
    selection,
    legend,
    getDoc,
    reviewMode,
    invalidate,
    onCancelGesture: () => {
      interaction.cancel();
      sceneRef.current.keyboardCursor = null;
      invalidate("all");
    },
    onZoomIn: view.zoomIn,
    onZoomOut: view.zoomOut,
    onZoomReset: view.reset,
    announce,
  });

  const exporter = useExport({
    taskId,
    getDoc,
    getImage: () => imageRef.current,
    measure,
    visionMode: tools.visionMode,
    showLegend: legend.enabled,
    reviewMode,
    onDone: (result) => {
      history.markClean();
      input.onExport?.(result);
    },
    onError: notify.reportError,
    onAnnounce: announce,
  });

  const zoomPercent = useMemo(() => {
    void viewVersion;
    const scene = sceneRef.current;
    return Math.round((scene.view.scale / Math.max(scene.fit, 1e-6)) * 100);
  }, [viewVersion]);

  return {
    sceneRef,
    renderer,
    view,
    measure,
    interaction,
    keyboard,
    imageSize,
    doc,
    dirty,
    ...tools,
    selectionIds,
    setSelectionIds,
    legendEnabled: legend.enabled,
    legendItems: legend.items,
    toggleLegend,
    setLegendItemText: legend.setItemText,
    announcement: notify.announcement,
    alert: notify.alert,
    textDraft: text.draft,
    restored: persistence.restored,
    restoreDraft: persistence.restoreDraft,
    discardDraft: persistence.discardDraft,
    viewJson: persistence.viewJson,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoText: history.undoText,
    redoText: history.redoText,
    undo: history.undo,
    redo: history.redo,
    deleteSelection: selection.remove,
    bringForward: selection.bringForward,
    sendBackward: selection.sendBackward,
    commitText: text.commit,
    cancelText: text.cancel,
    busy: exporter.busy,
    exportedPath: exporter.exportedPath,
    exportPng: exporter.run,
    copyPath: exporter.copyPath,
    toolLabel: TOOL_META[tools.tool].ariaLabel,
    zoomPercent,
    cursorStyle: buildCursor(tools.tool, reviewMode, runtime.status, sceneRef.current.spacePan),
    imageStatus: runtime.status,
  };
}

export type CanvasEngine = ReturnType<typeof useCanvasEngine>;
