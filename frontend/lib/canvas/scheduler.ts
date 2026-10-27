/**
 * Doc 07 §2.2 — rAF-batched, per-layer dirty scheduler.
 *
 * Every input handler mutates a ref and marks a layer; one animation frame
 * repaints only the dirty layers, in `base → ink → overlay` order.
 */
import type { LayerName } from "./types";

export const LAYER_ORDER: readonly LayerName[] = ["base", "ink", "overlay"];

export interface Scheduler {
  mark(layer: LayerName): void;
  flush(): void;
  dispose(): void;
}

export function createScheduler(paint: (layer: LayerName) => void): Scheduler {
  const dirty = new Set<LayerName>();
  let raf = 0;
  let disposed = false;

  const flush = (): void => {
    raf = 0;
    if (disposed) return;
    for (const layer of LAYER_ORDER) {
      if (!dirty.has(layer)) continue;
      dirty.delete(layer);
      paint(layer);
    }
  };

  return {
    mark(layer: LayerName) {
      if (disposed) return;
      dirty.add(layer);
      if (raf === 0) {
        raf = requestAnimationFrame(flush);
      }
    },
    flush() {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      flush();
    },
    dispose() {
      disposed = true;
      dirty.clear();
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
}

/** Throttles announcements to ≤ 1 per interval (§12.2). */
export function createThrottle(intervalMs: number, now: () => number = () => Date.now()) {
  let last = -Infinity;
  return (fn: () => void): void => {
    const t = now();
    if (t - last < intervalMs) return;
    last = t;
    fn();
  };
}
