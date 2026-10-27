"use client";

// Doc 09 §10.4 T3/T4 — the "stick to bottom" detector. Pure DOM maths plus the
// `newCount` accounting that feeds the pause badge; no layout knowledge of rows.
import { useCallback, useEffect, useRef, useState } from "react";

/** T3: at most 24 px of slack before the viewport stops counting as "bottom". */
export const BOTTOM_SLACK_PX = 24;

export interface AutoscrollOptions {
  /** total lines currently in the ring buffer (drives the effect) */
  lineCount: number;
  /** disable the behaviour entirely (e.g. while a search filter is active) */
  enabled?: boolean;
  /** honour `prefers-reduced-motion` in the scroll call (Doc 09 §14) */
  smooth?: boolean;
  /** externally owned element ref, shared with the virtual window */
  ref?: React.RefObject<HTMLDivElement | null>;
}

export interface AutoscrollApi {
  /** attach to the scrolling element */
  ref: React.RefObject<HTMLDivElement | null>;
  /** user scrolled away from the bottom (T3) */
  paused: boolean;
  /** lines that arrived while paused (T3 badge) */
  newCount: number;
  /** `false` pauses accounting; called with the measured value on every scroll */
  setAtBottom(atBottom: boolean): void;
  /** jump to newest and clear the badge (T4) */
  scrollToBottom(behavior?: ScrollBehavior): void;
  /** resume without scrolling (the caller owns the jump) */
  resume(): void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useAutoscroll({
  lineCount,
  enabled = true,
  smooth = true,
  ref,
}: AutoscrollOptions): AutoscrollApi {
  const localRef = useRef<HTMLDivElement | null>(null);
  const elementRef = ref ?? localRef;
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const pausedRef = useRef(false);
  const pendingRef = useRef(0);
  const seenRef = useRef(lineCount);

  const setAtBottom = useCallback((atBottom: boolean) => {
    if (pausedRef.current === !atBottom) return;
    pausedRef.current = !atBottom;
    setPaused(!atBottom);
    if (atBottom) {
      pendingRef.current = 0;
      setNewCount(0);
    }
  }, []);

  const scrollToBottom = useCallback(
    (behavior?: ScrollBehavior) => {
      const element = elementRef.current;
      pausedRef.current = false;
      pendingRef.current = 0;
      setPaused(false);
      setNewCount(0);
      if (!element) return;
      const mode: ScrollBehavior =
        behavior ?? (smooth && !prefersReducedMotion() ? "smooth" : "auto");
      element.scrollTo({ top: element.scrollHeight, behavior: mode });
    },
    [smooth, elementRef],
  );

  const resume = useCallback(() => {
    pausedRef.current = false;
    pendingRef.current = 0;
    setPaused(false);
    setNewCount(0);
  }, []);

  // Measure on scroll: cheap arithmetic, no observer needed (T3).
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const measure = (): void => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      setAtBottom(distance < BOTTOM_SLACK_PX);
    };
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => element.removeEventListener("scroll", measure);
  }, [setAtBottom, elementRef]);

  // New lines: follow when at bottom, otherwise accumulate the badge (T3).
  useEffect(() => {
    const delta = lineCount - seenRef.current;
    seenRef.current = lineCount;
    if (!enabled || delta <= 0) return;

    const element = elementRef.current;
    if (pausedRef.current) {
      pendingRef.current += delta;
      setNewCount(pendingRef.current);
      return;
    }
    if (element) element.scrollTop = element.scrollHeight;
  }, [lineCount, enabled, elementRef]);

  return { ref: elementRef, paused, newCount, setAtBottom, scrollToBottom, resume };
}
