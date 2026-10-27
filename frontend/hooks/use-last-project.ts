"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Doc 06 §5.2 — remembers the last project the operator opened so the header's
 * Dashboard link can jump straight back into it. `localStorage` only: this is
 * ephemeral UI state, never server data (Doc 06 §14).
 */

export const LAST_PROJECT_KEY = "atlas:last-project";

function read(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function rememberProject(slug: string | null): void {
  if (typeof window === "undefined" || !slug) return;
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, slug);
  } catch {
    /* storage disabled — the header falls back to the first project */
  }
}

export function useLastProject(fallback: string | null): string | null {
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    setSlug(read());
    const onStorage = (event: StorageEvent) => {
      if (event.key === LAST_PROJECT_KEY) setSlug(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const remember = useCallback((next: string | null) => {
    rememberProject(next);
    setSlug(next);
  }, []);

  return slug ?? fallback;
}
