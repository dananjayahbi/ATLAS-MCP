"use client";

/**
 * Doc 07 §9 — export orchestration: preflight, compose, hash, upload, notify.
 *
 * The image bitmap is passed in by the owner so this hook never holds a
 * reference that could outlive unmount (§11.4).
 */
import { useCallback, useRef, useState } from "react";
import { checkLegibility, rasteriseExport } from "@/lib/canvas/export";
import type { MeasureFn } from "@/lib/canvas/geometry";
import { uploadAnnotation } from "@/lib/canvas/upload";
import type { CanvasDocument, ExportResult } from "@/lib/canvas/types";

export interface ExportOptions {
  taskId: string;
  getDoc: () => CanvasDocument;
  getImage: () => ImageBitmap | null;
  measure: MeasureFn;
  visionMode: boolean;
  showLegend: boolean;
  reviewMode: boolean;
  onDone: (result: ExportResult) => void;
  onError: (error: unknown) => void;
  onAnnounce: (message: string) => void;
}

export interface ExportApi {
  busy: boolean;
  exportedPath: string | null;
  run: () => Promise<void>;
  copyPath: () => Promise<void>;
  setExportedPath: (path: string | null) => void;
}

export function useExport(options: ExportOptions): ExportApi {
  const [busy, setBusy] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const busyRef = useRef(false);
  const handlersRef = useRef(options);
  handlersRef.current = options;

  const run = useCallback(async () => {
    const current = handlersRef.current;
    if (current.reviewMode || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const doc = current.getDoc();
      const warnings = checkLegibility(doc, current.measure);
      const raster = await rasteriseExport({
        doc,
        image: current.getImage(),
        measure: current.measure,
        visionMode: current.visionMode,
        showLegend: current.showLegend,
      });
      if (raster.fontClamped || warnings.some((w) => w.code === "SMALL_TEXT")) {
        current.onAnnounce("Some labels were enlarged for legibility.");
      }
      const result = await uploadAnnotation({ taskId: current.taskId, doc, raster });
      setExportedPath(result.asset.absolute_path);
      current.onDone(result);
      current.onAnnounce(
        `Annotation exported. ${Math.max(1, Math.round(result.byte_size / 1024))} KB uploaded.`,
      );
    } catch (error) {
      current.onError(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const copyPath = useCallback(async () => {
    if (!exportedPath) return;
    try {
      await navigator.clipboard.writeText(exportedPath);
      handlersRef.current.onAnnounce("Path copied.");
    } catch (error) {
      handlersRef.current.onError(new Error(`Clipboard unavailable: ${String(error)}`));
    }
  }, [exportedPath]);

  return { busy, exportedPath, run, copyPath, setExportedPath };
}
