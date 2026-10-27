"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clampScale, drawMarkup, fitView, toImage, zoomAt } from "@/lib/markup";
import type { MarkupDocument, MarkupPoint, MarkupTool, MarkupView } from "@/lib/markup/types";

/**
 * The interaction surface of the markup canvas: pointer capture, pen/eraser,
 * space-to-pan, wheel-to-zoom and the render loop.
 *
 * Rendering is one scheduled frame per change, so a fast stroke cannot queue
 * more paints than the display can show.
 */

export type MarkupCanvasHandlers = {
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: (event: React.PointerEvent<HTMLCanvasElement>) => void;
};

export type UseMarkupCanvasOptions = {
  imageUrl: string;
  tool: MarkupTool;
  color: string;
  width: number;
  eraserRadius: number;
  doc: MarkupDocument;
  /** Live stroke points change without touching history. */
  onStrokeCommit: (points: MarkupPoint[], color: string, width: number) => void;
  onErase: (points: readonly MarkupPoint[]) => void;
  onImageReady: (size: { w: number; h: number }) => void;
  onError: (message: string) => void;
};

export type MarkupCanvasApi = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  handlers: MarkupCanvasHandlers;
  zoomPercent: number;
  panning: boolean;
  spaceDown: boolean;
  view: MarkupView;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  /** Image-natural size, or null before `onload`. */
  imageSize: { w: number; h: number } | null;
  /** The decoded source bitmap, for the burn-in pass. */
  image: HTMLImageElement | null;
};

export function useMarkupCanvas(options: UseMarkupCanvasOptions): MarkupCanvasApi {
  const { imageUrl, tool, color, width, eraserRadius, doc, onStrokeCommit, onErase, onImageReady, onError } =
    options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [view, setViewState] = useState<MarkupView>({ scale: 0.5, tx: 0, ty: 0 });
  const [fitScale, setFitScale] = useState(0.5);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);

  const previewRef = useRef<MarkupPoint[] | null>(null);
  const eraserPointsRef = useRef<MarkupPoint[]>([]);
  const eraserUpRef = useRef(false);
  const eraserAtRef = useRef<MarkupPoint | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  // Refs mirror the latest props so the render loop and pointer handlers never
  // need to be rebuilt (rebuilding them would drop an in-progress drag).
  const latest = useRef({ doc, tool, color, width, eraserRadius, view });
  latest.current = { doc, tool, color, width, eraserRadius, view };
  const spaceRef = useRef(spaceDown);
  spaceRef.current = spaceDown;

  /* ------------------------------------------------------------ render loop */

  const paint = useCallback(() => {
    frameRef.current = null;
    const canvas = overlayRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const current = latest.current;
    const live = previewRef.current;
    drawMarkup({
      ctx,
      doc: current.doc,
      view: current.view,
      preview:
        live && live.length > 0
          ? {
              id: "preview",
              tool: "pen",
              color: current.color,
              width: current.width,
              points: live,
            }
          : null,
      eraserRadius: current.tool === "eraser" && !eraserUpRef.current ? current.eraserRadius : null,
      eraserAt: eraserUpRef.current ? null : eraserAtRef.current,
    });
  }, []);

  const invalidate = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    invalidate();
  }, [invalidate, doc, view, tool, color, width, eraserRadius, panning]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  /* ------------------------------------------------------------ image load */

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      const size = {
        w: image.naturalWidth || image.width,
        h: image.naturalHeight || image.height,
      };
      setImageSize(size);
      setImage(image);
      onImageReady(size);
      const container = containerRef.current;
      if (container && container.clientWidth > 0) {
        const fitted = fitView({ w: container.clientWidth, h: container.clientHeight }, size);
        setFitScale(fitted.scale);
        setViewState(fitted);
      }
      invalidate();
    };
    image.onerror = () => {
      if (!cancelled) onError("The image could not be loaded.");
    };
    image.src = imageUrl;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [imageUrl, invalidate, onError, onImageReady]);

  /* ------------------------------------------------------------ fit on resize */

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const image = imageRef.current;
      if (!image) return;
      const size = { w: image.naturalWidth || image.width, h: image.naturalHeight || image.height };
      const fitted = fitView({ w: container.clientWidth, h: container.clientHeight }, size);
      setFitScale(fitted.scale);
      setViewState(fitted);
      invalidate();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [invalidate]);

  /* ------------------------------------------------------------ spacebar pan */

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTyping(event.target)) return;
      // Space is also the dialog's scroll key; the canvas owns it while open.
      event.preventDefault();
      setSpaceDown(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* ------------------------------------------------------------ pointer */

  const cssOf = (event: React.PointerEvent<HTMLCanvasElement>): MarkupPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlers: MarkupCanvasHandlers = {
    onPointerDown: (event) => {
      if (event.button === 1 || spaceRef.current) {
        panRef.current = { x: event.clientX, y: event.clientY };
        setPanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (event.button !== 0) return;
      const point = toImage(cssOf(event), view);
      event.currentTarget.setPointerCapture(event.pointerId);

      if (tool === "eraser") {
        eraserPointsRef.current = [point];
        eraserUpRef.current = false;
        eraserAtRef.current = point;
        onErase([point]);
        invalidate();
        return;
      }
      previewRef.current = [point];
      invalidate();
    },

    onPointerMove: (event) => {
      const pan = panRef.current;
      if (pan) {
        const dx = event.clientX - pan.x;
        const dy = event.clientY - pan.y;
        panRef.current = { x: event.clientX, y: event.clientY };
        setViewState((current) => ({ ...current, tx: current.tx + dx, ty: current.ty + dy }));
        return;
      }

      if (tool === "eraser") {
        eraserAtRef.current = toImage(cssOf(event), view);
        eraserUpRef.current = false;
        invalidate();
        return;
      }

      const live = previewRef.current;
      if (!live) return;
      live.push(toImage(cssOf(event), view));
      invalidate();
    },

    onPointerUp: (event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (panRef.current) {
        panRef.current = null;
        setPanning(false);
        return;
      }
      if (tool === "eraser") {
        eraserPointsRef.current = [];
        return;
      }
      const live = previewRef.current;
      previewRef.current = null;
      if (live && live.length > 0) onStrokeCommit(live, color, width);
      invalidate();
    },

    onPointerLeave: () => {
      eraserAtRef.current = null;
      eraserUpRef.current = true;
      invalidate();
    },
  };

  /* ------------------------------------------------------------ wheel zoom */

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setViewState((current) => zoomAt(current, anchor, current.scale * factor));
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  /* ------------------------------------------------------------ controls */

  const zoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const anchor = { x: container.clientWidth / 2, y: container.clientHeight / 2 };
    setViewState((current) => zoomAt(current, anchor, current.scale * 1.25));
  }, []);

  const zoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const anchor = { x: container.clientWidth / 2, y: container.clientHeight / 2 };
    setViewState((current) => zoomAt(current, anchor, current.scale / 1.25));
  }, []);

  const resetView = useCallback(() => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image) return;
    setViewState(
      fitView(
        { w: container.clientWidth, h: container.clientHeight },
        { w: image.naturalWidth || image.width, h: image.naturalHeight || image.height },
      ),
    );
  }, []);

  return {
    containerRef,
    overlayRef,
    handlers,
    zoomPercent: Math.round((view.scale / Math.max(fitScale, 1e-6)) * 100),
    panning,
    spaceDown,
    zoomIn,
    zoomOut,
    resetView,
    imageSize,
    image,
    view,
  };
}

export function clampMarkupScale(scale: number): number {
  return clampScale(scale);
}
