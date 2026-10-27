"use client";

/**
 * Doc 07 §2.3 — projects *committed* React state into the mutable scene the
 * rAF loop reads.
 *
 * Pointer previews, hover and marquee are written straight to the scene and
 * never appear here, so a 240 Hz drag cannot re-render React (§2.2).
 */
import { useEffect } from "react";
import type { CanvasDocument, LegendItem } from "@/lib/canvas/types";
import type { Scene } from "./scene";

export interface SceneProjectionOptions {
  sceneRef: { current: Scene };
  doc: CanvasDocument;
  selectionIds: string[];
  visionMode: boolean;
  legendEnabled: boolean;
  legendItems: LegendItem[];
  reviewMode: boolean;
  invalidate: (layer?: "base" | "ink" | "overlay" | "all") => void;
}

export function useSceneProjection(options: SceneProjectionOptions): void {
  const {
    sceneRef,
    doc,
    selectionIds,
    visionMode,
    legendEnabled,
    legendItems,
    reviewMode,
    invalidate,
  } = options;

  useEffect(() => {
    const scene = sceneRef.current;
    scene.doc = { ...doc, legend: { enabled: legendEnabled, items: legendItems } };
    scene.visionMode = visionMode;
    scene.showLegend = legendEnabled;
    scene.reviewMode = reviewMode;
    invalidate("all");
  }, [doc, invalidate, legendEnabled, legendItems, reviewMode, sceneRef, visionMode]);

  useEffect(() => {
    sceneRef.current.selection = new Set(selectionIds);
    invalidate("overlay");
  }, [invalidate, sceneRef, selectionIds]);
}
