"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isTypingTarget, useHotkeys, type Hotkey, type HotkeyScope } from "./use-hotkeys";

/**
 * Doc 06 §12.1 — the keyboard map that every list-like surface shares:
 * `j`/`k` traversal, `Enter` open, `a` approve, `r` reject, `/` search, `?` cheat
 * sheet, `Esc` cascade, and the `g`-prefixed route chords.
 */

export type KeyboardNavOptions = {
  /** Ordered ids of the current list. */
  ids: readonly string[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onOpen?: (id: string) => void;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onSearchFocus?: () => void;
  onEscape?: () => boolean | void;
  onToggleCheatSheet?: () => void;
  /** Extra descriptors registered by the surface (matrix, pane, modal…). */
  extra?: Hotkey[];
  scopes?: HotkeyScope[];
  enabled?: boolean;
};

export type KeyboardNav = {
  next: () => void;
  previous: () => void;
  first: () => void;
  last: () => void;
  activeId: string | null;
  chordArmed: boolean;
};

export const CHORD_PREFIX = "g";

export function useKeyboardNav({
  ids,
  activeIndex,
  setActiveIndex,
  onOpen,
  onApprove,
  onReject,
  onSearchFocus,
  onEscape,
  onToggleCheatSheet,
  extra,
  scopes = ["global"],
  enabled = true,
}: KeyboardNavOptions): KeyboardNav {
  const router = useRouter();
  const [chordArmed, setChordArmed] = useState(false);
  const count = ids.length;

  const clampIndex = useCallback(
    (index: number) => {
      if (count === 0) return 0;
      return ((index % count) + count) % count;
    },
    [count],
  );

  const next = useCallback(() => setActiveIndex(clampIndex(activeIndex + 1)), [activeIndex, clampIndex, setActiveIndex]);
  const previous = useCallback(() => setActiveIndex(clampIndex(activeIndex - 1)), [activeIndex, clampIndex, setActiveIndex]);
  const first = useCallback(() => setActiveIndex(0), [setActiveIndex]);
  const last = useCallback(() => setActiveIndex(Math.max(0, count - 1)), [count, setActiveIndex]);

  const activeId = ids[activeIndex] ?? null;

  // `g` chord: arm for 800 ms, then dispatch a single second key (Doc 06 §12.2 rule 3).
  useEffect(() => {
    if (!chordArmed) return;
    const timer = window.setTimeout(() => setChordArmed(false), 800);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (isTypingTarget(event.target)) {
        setChordArmed(false);
        return;
      }
      const key = event.key.toLowerCase();
      const routes: Record<string, string> = { b: "/", c: "/", d: "/discoveries", r: "/reviews" };
      const target = routes[key];
      if (target) {
        event.preventDefault();
        router.push(target);
      }
      setChordArmed(false);
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [chordArmed, router]);

  const hotkeys = useMemo<Hotkey[]>(() => {
    const list: Hotkey[] = [
      { key: "j", scopes: [...scopes], run: next },
      { key: "ArrowDown", scopes: [...scopes], run: next, allowInInput: false },
      { key: "k", scopes: [...scopes], run: previous },
      { key: "ArrowUp", scopes: [...scopes], run: previous, allowInInput: false },
      { key: "Home", scopes: [...scopes], run: first },
      { key: "End", scopes: [...scopes], run: last },
      {
        key: "Enter",
        scopes: [...scopes],
        allowInInput: true,
        run: () => {
          if (activeId && onOpen) onOpen(activeId);
        },
      },
      { key: "a", scopes: [...scopes], run: () => activeId && onApprove?.(activeId) },
      { key: "r", scopes: [...scopes], run: () => activeId && onReject?.(activeId) },
      { key: "/", scopes: ["global"], run: () => onSearchFocus?.() },
      { key: "?", scopes: ["global"], run: () => onToggleCheatSheet?.() },
      {
        key: "Escape",
        scopes: ["global"],
        allowInInput: true,
        run: (event) => {
          const handled = onEscape?.();
          if (!handled) {
            const target = event.target;
            if (target instanceof HTMLElement) target.blur();
          }
        },
      },
      { key: CHORD_PREFIX, scopes: ["global"], run: () => setChordArmed(true) },
    ];
    return extra ? [...list, ...extra] : list;
  }, [activeId, extra, first, last, next, onEscape, onOpen, onApprove, onReject, onSearchFocus, onToggleCheatSheet, previous, scopes]);

  useHotkeys(hotkeys, { scopeStack: scopes, enabled });

  return { next, previous, first, last, activeId, chordArmed };
}
