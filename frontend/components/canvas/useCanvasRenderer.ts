"use client";

/**
 * Doc 07 §2.1 / §5.3 — owns the three canvases, the DPR-matched backing stores
 * and the rAF paint loop. Nothing else in the component tree draws.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createMeasureFn, drawBase, drawInk, drawOverlay } from "@/lib/canvas/render";
import type { MeasureFn } from "@/lib/canvas/geometry";import { createScheduler, type Scheduler } from "@/lib/canvas/scheduler";
import type { LayerName, Size } from "@/lib/canvas/types";
import {
  applyDpr,
  clampPan,
  clampScale,
  fitScale,
  fitView,
  resolveDpr,
  zoomAtPoint,
} from "@/lib/canvas/viewport";
import type { Scene } from "./scene";

export interface Ref<T> {
  current: T;
}

export interface RendererApi {
  wrapperRef: Ref<HTMLDivElement | null>;
  baseRef: Ref<HTMLCanvasElement | null>;
  inkRef: Ref<HTMLCanvasElement | null>;
  overlayRef: Ref<HTMLCanvasElement | null>;
  size: Size;
  measure: MeasureFn;
  invalidate: (layer?: LayerName | "all") => void;
  zoomBy: (factor: number) => void;
  zoomReset: () => void;
  /** Recompute fit + centre, used when the source bitmap first resolves. */
  refit: () => void;
  repaintAll: () => void;
}

export function useCanvasRenderer(sceneRef: Ref<Scene>): RendererApi {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const inkRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const schedulerRef = useRef<Scheduler | null>(null);
  const measureRef = useRef<MeasureFn>(createMeasureFn());
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  const paint = useCallback(
    (layer: LayerName) => {
      const scene = sceneRef.current;
      const measure = measureRef.current;
      if (layer === "base" && baseRef.current) {
        const ctx = baseRef.current.getContext("2d");
        if (ctx) {
          drawBase({
            ctx,
            css: scene.container,
            view: scene.view,
            doc: scene.doc,
            image: scene.image,
            imageStatus: scene.imageStatus,
            dpr: scene.dpr,
            dimOutsideCrop: scene.doc.crop != null,
            previewBlur: scene.previewBlur,
          });
        }
      } else if (layer === "ink" && inkRef.current) {
        const ctx = inkRef.current.getContext("2d");
        if (ctx) {
          drawInk({
            ctx,
            css: scene.container,
            view: scene.view,
            doc: scene.doc,
            dpr: scene.dpr,
            measure,
            visionMode: scene.visionMode,
            showLegend: scene.showLegend,
          });
        }
      } else if (layer === "overlay" && overlayRef.current) {
        const ctx = overlayRef.current.getContext("2d");
        if (ctx) {
          drawOverlay({
            ctx,
            css: scene.container,
            view: scene.view,
            dpr: scene.dpr,
            doc: scene.doc,
            measure,
            selection: scene.selection,
            hoveredId: scene.hoveredId,
            marquee: scene.marquee,
            previewStroke: scene.previewStroke,
            previewBlur: scene.previewBlur,
            cursor: scene.cursor,
            keyboardCursor: scene.keyboardCursor,
            showHandles: !scene.reviewMode,
            pointerDown: scene.pointerDown,
          });
        }
      }
    },
    [sceneRef],
  );

  const invalidate = useCallback((layer: LayerName | "all" = "all") => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    if (layer === "all") {
      scheduler.mark("base");
      scheduler.mark("ink");
      scheduler.mark("overlay");
      return;
    }
    scheduler.mark(layer);
  }, []);

  useEffect(() => {
    const scheduler = createScheduler(paint);
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [paint]);

  const resizeNow = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = resolveDpr();
    const scene = sceneRef.current;
    scene.dpr = dpr;
    scene.container = { w: cssW, h: cssH };
    for (const canvas of [baseRef.current, inkRef.current, overlayRef.current]) {
      if (canvas) applyDpr(canvas, cssW, cssH, dpr);
    }
    const image = scene.doc.imageNaturalSize;
    const container = { w: cssW, h: cssH };
    const nextFit = fitScale(container, image);
    const previousFit = scene.fit;
    const wasUnset = previousFit <= 0 || !Number.isFinite(previousFit);
    scene.fit = nextFit;
    scene.view = wasUnset
      ? fitView(container, image)
      : zoomAtPoint(
          scene.view,
          { x: cssW / 2, y: cssH / 2 },
          clampScale((scene.view.scale / previousFit) * nextFit, nextFit),
          nextFit,
          container,
          image,
        );
    setSize(container);
    invalidate("all");
  }, [invalidate, sceneRef]);

  /** Recentres on the real image once the bitmap dimensions are known. */
  const refit = useCallback(() => {
    const scene = sceneRef.current;
    const container = scene.container;
    const image = scene.doc.imageNaturalSize;
    if (container.w <= 0 || container.h <= 0) return;
    scene.fit = fitScale(container, image);
    scene.view = fitView(container, image);
    setSize({ ...container });
    invalidate("all");
  }, [invalidate, sceneRef]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let raf = 0;
    const schedule = () => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        resizeNow();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    resizeNow();
    return () => {
      observer.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [resizeNow]);

  const zoomBy = useCallback(
    (factor: number) => {
      const scene = sceneRef.current;
      const anchor = { x: scene.container.w / 2, y: scene.container.h / 2 };
      scene.view = zoomAtPoint(
        scene.view,
        anchor,
        scene.view.scale * factor,
        scene.fit,
        scene.container,
        scene.doc.imageNaturalSize,
      );
      setSize((s) => ({ ...s }));
      invalidate("all");
    },
    [invalidate, sceneRef],
  );

  const zoomReset = useCallback(() => {
    const scene = sceneRef.current;
    scene.view = clampPan(
      fitView(scene.container, scene.doc.imageNaturalSize),
      scene.container,
      scene.doc.imageNaturalSize,
    );
    setSize((s) => ({ ...s }));
    invalidate("all");
  }, [invalidate, sceneRef]);

  const repaintAll = useCallback(() => {
    invalidate("all");
  }, [invalidate]);

  return {
    wrapperRef,
    baseRef,
    inkRef,
    overlayRef,
    size,
    measure: measureRef.current,
    invalidate,
    zoomBy,
    zoomReset,
    refit,
    repaintAll,
  };
}
