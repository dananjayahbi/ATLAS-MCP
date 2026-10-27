"use client";

/**
 * Doc 07 §17.3 — Doc 07 publishes no store. This context exists only so the
 * composition files under `components/canvas/` can share the engine instance
 * without prop-drilling twenty fields. It is not exported from the barrelled
 * public surface and Doc 06 must not import it.
 */
import { createContext, useContext } from "react";
import type { CanvasEngine } from "./useCanvasEngine";

const EngineContext = createContext<CanvasEngine | null>(null);

export const CanvasEngineProvider = EngineContext.Provider;

export function useEngine(): CanvasEngine {
  const engine = useContext(EngineContext);
  if (!engine) {
    throw new Error("Canvas engine context is missing; render inside <AnnotationCanvas>.");
  }
  return engine;
}
