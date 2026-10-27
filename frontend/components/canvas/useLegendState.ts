"use client";

/**
 * Doc 07 §10.7 — legend enablement and the user's typed row text.
 *
 * Only labels present in the document are kept, so deleting `[2]` also drops
 * its legend row without renumbering anything (§10.6).
 */
import { useCallback, useMemo, useState } from "react";
import type { CanvasDocument, LegendItem } from "@/lib/canvas/types";
import { describeForLegend } from "./legend";

export interface LegendStateOptions {
  doc: CanvasDocument;
  initialEnabled?: boolean;
  initialItems?: LegendItem[];
  getDoc: () => CanvasDocument;
  announce: (message: string) => void;
}

export interface LegendState {
  enabled: boolean;
  items: LegendItem[];
  setEnabled: (enabled: boolean) => void;
  setItemText: (label: number, text: string) => void;
}

export function useLegendState(options: LegendStateOptions): LegendState {
  const { doc, initialEnabled = false, initialItems = [] } = options;
  const [enabled, setEnabled] = useState(initialEnabled);
  const [typed, setTyped] = useState<LegendItem[]>(initialItems);

  const items = useMemo<LegendItem[]>(() => {
    const labelled = doc.strokes.filter(
      (s): s is typeof s & { label: number } => typeof s.label === "number",
    );
    return labelled
      .map((stroke) => ({
        label: stroke.label,
        text: typed.find((item) => item.label === stroke.label)?.text || describeForLegend(stroke),
      }))
      .sort((a, b) => a.label - b.label);
  }, [doc.strokes, typed]);

  const setItemText = useCallback((label: number, text: string) => {
    setTyped((prev) =>
      [...prev.filter((item) => item.label !== label), { label, text }].sort((a, b) => a.label - b.label),
    );
  }, []);

  return { enabled, items, setEnabled, setItemText };
}
