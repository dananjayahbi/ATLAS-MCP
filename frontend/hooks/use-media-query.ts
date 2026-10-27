"use client";

import { useEffect, useState } from "react";

/** Doc 06 §5.3 — breakpoint queries map onto the frozen `hud-dual` / `hud-quad` tokens. */

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsDual(): boolean {
  return useMediaQuery("(min-width: 1280px)");
}

export function useIsQuad(): boolean {
  return useMediaQuery("(min-width: 1920px)");
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** Doc 06 §16.5 — never render a skeleton that would flash for < 150 ms. */
export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return visible;
}
