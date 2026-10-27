"use client";

/**
 * Doc 07 §13 — autosave wiring, restore prompt, multi-tab notice and the
 * source-image lifecycle. Extracted from `useCanvasEngine` so each concern
 * stays testable and small.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearSnapshot,
  createAutosave,
  loadSnapshot,
  readSnapshotJson,
  subscribeStorage,
  type Autosave,
  type RestoreResult,
} from "@/lib/canvas/autosave";
import { createEmptyDocument } from "@/lib/canvas/document";
import { toCanvasError } from "@/lib/canvas/errors";
import { disposeBitmap, loadBitmap } from "@/lib/canvas/image";
import type { CanvasDocument, Size } from "@/lib/canvas/types";

export interface PersistenceOptions {
  taskId: string;
  sourceAssetId: string;
  initialDocument?: CanvasDocument;
  doc: CanvasDocument;
  dirty: boolean;
  onError: (error: unknown) => void;
  onAnnounce: (message: string) => void;
  onRestore: (doc: CanvasDocument) => void;
  onDiscard: (empty: CanvasDocument) => void;
}

export interface PersistenceApi {
  restored: RestoreResult | null;
  restoreDraft: () => void;
  discardDraft: () => void;
  viewJson: () => void;
  flush: () => void;
}

export function usePersistence(options: PersistenceOptions): PersistenceApi {
  const { taskId, sourceAssetId, initialDocument, doc, dirty } = options;
  const autosaveRef = useRef<Autosave | null>(null);
  const checkedRef = useRef(false);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const handlersRef = useRef(options);
  handlersRef.current = options;

  useEffect(() => {
    const autosave = createAutosave({
      taskId,
      onError: (error) => handlersRef.current.onError(error),
    });
    autosaveRef.current = autosave;
    return () => {
      autosave.flush();
      autosave.dispose();
      autosaveRef.current = null;
    };
  }, [taskId]);

  useEffect(() => {
    if (dirty) autosaveRef.current?.schedule(doc);
  }, [dirty, doc]);

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

  useEffect(() => {
    if (checkedRef.current || initialDocument) return;
    checkedRef.current = true;
    const result = loadSnapshot(taskId, sourceAssetId);
    if (result.error) {
      handlersRef.current.onError(result.error);
      return;
    }
    if (result.outcome !== "ok" && result.outcome !== "stale") return;
    setRestored(result);
    if (result.outcome === "ok" && result.doc) handlersRef.current.onRestore(result.doc);
  }, [initialDocument, sourceAssetId, taskId]);

  useEffect(
    () =>
      subscribeStorage(taskId, (foreign) => {
        if (foreign) handlersRef.current.onAnnounce("Another tab saved a draft for this task.");
      }),
    [taskId],
  );

  const restoreDraft = useCallback(() => {
    const draft = restored?.doc;
    if (!draft) return;
    options.onRestore(draft);
    setRestored(null);
    options.onAnnounce("Draft restored.");
  }, [options, restored]);

  const discardDraft = useCallback(() => {
    clearSnapshot(taskId);
    options.onDiscard(createEmptyDocument(sourceAssetId, doc.imageNaturalSize));
    setRestored(null);
    options.onAnnounce("Draft discarded.");
  }, [doc.imageNaturalSize, options, sourceAssetId, taskId]);

  const viewJson = useCallback(() => {
    const raw = readSnapshotJson(taskId);
    if (raw) options.onAnnounce(raw.slice(0, 400));
  }, [options, taskId]);

  return {
    restored,
    restoreDraft,
    discardDraft,
    viewJson,
    flush: () => {
      autosaveRef.current?.flush();
    },
  };
}

export interface SourceImageOptions {
  url: string;
  initialDocument?: CanvasDocument;
  onLoaded: (bitmap: ImageBitmap, size: Size) => void;
  onError: (error: unknown) => void;
  onStatus: (status: "loading" | "ready" | "error") => void;
}

/** §11.4 — decode once, close on unmount, never throw into React. */
export function useSourceImage(options: SourceImageOptions): void {
  const handlersRef = useRef(options);
  handlersRef.current = options;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    handlersRef.current.onStatus("loading");
    loadBitmap(options.url, controller.signal)
      .then((loaded) => {
        if (cancelled) {
          disposeBitmap(loaded.bitmap);
          return;
        }
        handlersRef.current.onLoaded(loaded.bitmap, loaded.size);
        handlersRef.current.onStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        handlersRef.current.onStatus("error");
        if (error instanceof DOMException && error.name === "AbortError") return;
        handlersRef.current.onError(toCanvasError(error));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [options.url]);
}
