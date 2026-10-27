"use client";

/**
 * Doc 07 §7.3 — pan and zoom: space+drag, middle-drag, ctrl/⌘+wheel,
 * two-finger pinch, and the `+`/`−`/`0` keyboard parity.
 *
 * Plain wheel is deliberately *not* trapped (it scrolls the page, §7.3).
 */
import { useCallback, useEffect, useRef } from "react";
import type { Scene } from "./scene";
import { panBy, wheelZoomScale, zoomAtPoint } from "@/lib/canvas/viewport";
import type { Point } from "@/lib/canvas/types";

export interface WheelLike {
  clientX: number;
  clientY: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
  currentTarget: EventTarget | null;
}

export interface ViewApi {
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => boolean;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => boolean;
  onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  onWheel: (event: WheelLike) => void;
  isPanning: () => boolean;
}

interface PanState {
  pointerId: number;
  last: Point;
}

export function useCanvasView(
  sceneRef: { current: Scene },
  invalidate: (layer?: "base" | "ink" | "overlay" | "all") => void,
  onViewChange?: () => void,
): ViewApi {
  const panRef = useRef<PanState | null>(null);
  const pinchRef = useRef<Map<number, Point>>(new Map());
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);

  const applyView = useCallback(
    (next: { scale: number; tx: number; ty: number }) => {
      const scene = sceneRef.current;
      scene.view = next;
      invalidate("all");
      onViewChange?.();
    },
    [invalidate, onViewChange, sceneRef],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): boolean => {
      const scene = sceneRef.current;
      if (event.pointerType === "touch") {
        pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pinchRef.current.size === 2) {
          const [a, b] = [...pinchRef.current.values()];
          pinchStartRef.current = {
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            scale: scene.view.scale,
          };
          return true;
        }
      }
      const wantsPan = event.button === 1 || scene.spacePan;
      if (!wantsPan) return false;
      panRef.current = { pointerId: event.pointerId, last: { x: event.clientX, y: event.clientY } };
      event.currentTarget.setPointerCapture(event.pointerId);
      return true;
    },
    [sceneRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): boolean => {
      const scene = sceneRef.current;
      if (event.pointerType === "touch" && pinchRef.current.has(event.pointerId)) {
        pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const start = pinchStartRef.current;
        if (start && pinchRef.current.size === 2) {
          const [a, b] = [...pinchRef.current.values()];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const ratio = start.distance === 0 ? 1 : distance / start.distance;
          const anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const rect = event.currentTarget.getBoundingClientRect();
          applyView(
            zoomAtPoint(
              { ...scene.view, scale: start.scale },
              { x: anchor.x - rect.left, y: anchor.y - rect.top },
              start.scale * ratio,
              scene.fit,
              scene.container,
              scene.doc.imageNaturalSize,
            ),
          );
          return true;
        }
      }
      const pan = panRef.current;
      if (!pan || pan.pointerId !== event.pointerId) return false;
      const dx = event.clientX - pan.last.x;
      const dy = event.clientY - pan.last.y;
      pan.last = { x: event.clientX, y: event.clientY };
      applyView(panBy(scene.view, dx, dy, scene.container, scene.doc.imageNaturalSize));
      return true;
    },
    [applyView, sceneRef],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>): boolean => {
    pinchRef.current.delete(event.pointerId);
    if (pinchRef.current.size < 2) pinchStartRef.current = null;
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return false;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    return true;
  }, []);

  const zoomIn = useCallback(() => {
    const scene = sceneRef.current;
    applyView(
      zoomAtPoint(
        scene.view,
        { x: scene.container.w / 2, y: scene.container.h / 2 },
        scene.view.scale * 1.25,
        scene.fit,
        scene.container,
        scene.doc.imageNaturalSize,
      ),
    );
  }, [applyView, sceneRef]);

  const zoomOut = useCallback(() => {
    const scene = sceneRef.current;
    applyView(
      zoomAtPoint(
        scene.view,
        { x: scene.container.w / 2, y: scene.container.h / 2 },
        scene.view.scale / 1.25,
        scene.fit,
        scene.container,
        scene.doc.imageNaturalSize,
      ),
    );
  }, [applyView, sceneRef]);

  const reset = useCallback(() => {
    const scene = sceneRef.current;
    applyView(
      zoomAtPoint(
        scene.view,
        { x: scene.container.w / 2, y: scene.container.h / 2 },
        scene.fit,
        scene.fit,
        scene.container,
        scene.doc.imageNaturalSize,
      ),
    );
  }, [applyView, sceneRef]);

  const onWheel = useCallback(
    (event: WheelLike) => {
      if (!event.ctrlKey && !event.metaKey) return; // §7.3: plain wheel scrolls
      event.preventDefault();
      const scene = sceneRef.current;
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) return;
      const rect = target.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const nextScale = wheelZoomScale(scene.view.scale, event.deltaY, scene.fit);
      applyView(
        zoomAtPoint(scene.view, anchor, nextScale, scene.fit, scene.container, scene.doc.imageNaturalSize),
      );
    },
    [applyView, sceneRef],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomIn,
    zoomOut,
    reset,
    onWheel,
    isPanning: () => panRef.current !== null,
  };
}

/** Attaches a non-passive `wheel` listener so ctrl+zoom can preventDefault. */
export function useNonPassiveWheel(
  ref: { current: HTMLCanvasElement | null },
  handler: (event: WheelEvent) => void,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (event: WheelEvent) => handler(event);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, [handler, ref]);
}
