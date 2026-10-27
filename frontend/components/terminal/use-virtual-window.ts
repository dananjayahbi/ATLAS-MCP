"use client";

// Doc 09 §10.4 T1/T12 — dependency-free windowing. Renders only the visible slice
// plus overscan, positioned with a translate. `content-visibility` is deliberately
// NOT used: it breaks scroll anchoring at 2 000 rows (T12).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** T1: fixed row height. Wrapped multi-line rows still occupy one slot of 4 lines max. */
export const ROW_H = 18;
/** T1: ~60 visible rows + 10 overscan on each side. */
export const OVERSCAN = 10;
export const VIEWPORT_ROWS = 60;

export interface VirtualWindowOptions {
  count: number;
  rowHeight?: number;
  overscan?: number;
}

export interface VirtualWindow {
  ref: React.RefObject<HTMLDivElement | null>;
  /** first rendered index (inclusive) */
  start: number;
  /** last rendered index (exclusive) */
  end: number;
  /** translate offset for the rendered slice */
  offsetY: number;
  /** full virtual height, so the scrollbar reflects the whole buffer (T2) */
  totalHeight: number;
  /** measured viewport height in px */
  viewportHeight: number;
  /** imperative scroll helpers */
  scrollToIndex(index: number, behavior?: ScrollBehavior): void;
}

export function useVirtualWindow({
  count,
  rowHeight = ROW_H,
  overscan = OVERSCAN,
}: VirtualWindowOptions): VirtualWindow {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(VIEWPORT_ROWS * ROW_H);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onScroll = (): void => setScrollTop(element.scrollTop);
    element.addEventListener("scroll", onScroll, { passive: true });

    const measure = (): void => setViewportHeight(element.clientHeight || VIEWPORT_ROWS * ROW_H);
    measure();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    } else if (typeof window !== "undefined") {
      window.addEventListener("resize", measure);
    }

    return () => {
      element.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (!observer && typeof window !== "undefined") {
        window.removeEventListener("resize", measure);
      }
    };
  }, []);

  const { start, end } = useMemo(() => {
    const visible = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const first = Math.floor(scrollTop / rowHeight);
    return {
      start: Math.max(0, first - overscan),
      end: Math.min(count, first + visible + overscan),
    };
  }, [scrollTop, viewportHeight, rowHeight, overscan, count]);

  const totalHeight = count * rowHeight;

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "auto") => {
      const element = ref.current;
      if (!element) return;
      const clamped = Math.max(0, Math.min(index, count - 1));
      element.scrollTo({ top: clamped * rowHeight, behavior });
    },
    [count, rowHeight],
  );

  return {
    ref,
    start,
    end,
    offsetY: start * rowHeight,
    totalHeight,
    viewportHeight,
    scrollToIndex,
  };
}
