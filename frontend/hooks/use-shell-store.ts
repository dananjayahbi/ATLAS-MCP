"use client";

import { create } from "zustand";
import type { HotkeyScope } from "./use-hotkeys";

/** Doc 06 §14 — ephemeral UI state only. Server data never lives here. */

export type SplitLayout = "1x1" | "1x2" | "2x2" | "2x3";

export const LAYOUT_CAPACITY: Record<SplitLayout, number> = {
  "1x1": 1,
  "1x2": 2,
  "2x2": 4,
  "2x3": 6,
};

export const LAYOUT_LABEL: Record<SplitLayout, string> = {
  "1x1": "1×1",
  "1x2": "1×2",
  "2x2": "2×2",
  "2x3": "2×3",
};

export type PaneAssignment = {
  slot: number;
  projectSlug: string | null;
  taskId: string | null;
};

export type ShellStore = {
  layout: SplitLayout;
  focusedSlot: number;
  panes: PaneAssignment[];
  scopeStack: HotkeyScope[];
  cheatSheetOpen: boolean;
  railCollapsed: boolean;
  setLayout: (layout: SplitLayout) => void;
  focusSlot: (slot: number) => void;
  assign: (slot: number, projectSlug: string | null, taskId?: string | null) => void;
  clearSlot: (slot: number) => void;
  pushScope: (scope: HotkeyScope) => void;
  popScope: (scope: HotkeyScope) => void;
  toggleCheatSheet: (open?: boolean) => void;
  toggleRail: () => void;
};

export function capacityOf(layout: SplitLayout): number {
  return LAYOUT_CAPACITY[layout];
}

function padPanes(panes: PaneAssignment[], capacity: number): PaneAssignment[] {
  const next = panes.slice(0, capacity);
  for (let slot = next.length; slot < capacity; slot += 1) {
    next.push({ slot, projectSlug: null, taskId: null });
  }
  return next.map((pane, slot) => ({ ...pane, slot }));
}

export const useShellStore = create<ShellStore>((set) => ({
  layout: "1x2",
  focusedSlot: 0,
  panes: padPanes([], LAYOUT_CAPACITY["1x2"]),
  scopeStack: ["global"],
  cheatSheetOpen: false,
  railCollapsed: false,
  setLayout: (layout) =>
    set((state) => ({
      layout,
      panes: padPanes(state.panes, capacityOf(layout)),
      focusedSlot: Math.min(state.focusedSlot, capacityOf(layout) - 1),
    })),
  focusSlot: (slot) => set((state) => ({ focusedSlot: Math.min(Math.max(0, slot), capacityOf(state.layout) - 1) })),
  assign: (slot, projectSlug, taskId = null) =>
    set((state) => {
      const panes = padPanes(state.panes, capacityOf(state.layout));
      panes[slot] = { slot, projectSlug, taskId };
      return { panes, focusedSlot: slot };
    }),
  clearSlot: (slot) =>
    set((state) => {
      const panes = padPanes(state.panes, capacityOf(state.layout));
      panes[slot] = { slot, projectSlug: null, taskId: null };
      return { panes };
    }),
  pushScope: (scope) =>
    set((state) => (state.scopeStack.includes(scope) ? state : { scopeStack: [...state.scopeStack, scope] })),
  popScope: (scope) => set((state) => ({ scopeStack: state.scopeStack.filter((s) => s !== scope) })),
  toggleCheatSheet: (open) => set((state) => ({ cheatSheetOpen: open ?? !state.cheatSheetOpen })),
  toggleRail: () => set((state) => ({ railCollapsed: !state.railCollapsed })),
}));

/** First empty slot, else the focused one (Doc 06 §6.2). */
export function firstEmptySlot(panes: PaneAssignment[]): number {
  const index = panes.findIndex((pane) => pane.projectSlug === null);
  return index >= 0 ? index : -1;
}
