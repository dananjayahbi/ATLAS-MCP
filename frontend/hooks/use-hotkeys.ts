"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Doc 06 §12.2 — exactly one `keydown` listener per `useHotkeys` instance.
 * Feature components register descriptors; they never attach handlers inline.
 */

export type HotkeyScope = "global" | "board" | "triage" | "review" | "pane" | "matrix" | "modal";

export type Hotkey = {
  /** `KeyboardEvent.key`, case-insensitive for single characters. */
  key: string;
  mod?: boolean;
  shift?: boolean;
  scopes: HotkeyScope[];
  run: (event: KeyboardEvent) => void;
  allowInInput?: boolean;
};

export const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

function matches(hotkey: Hotkey, event: KeyboardEvent): boolean {
  const key = hotkey.key.length === 1 ? hotkey.key.toLowerCase() : hotkey.key;
  const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key !== pressed) return false;
  const wantsMod = hotkey.mod ?? false;
  const hasMod = event.metaKey || event.ctrlKey;
  if (wantsMod !== hasMod) return false;
  if ((hotkey.shift ?? false) !== event.shiftKey && hotkey.key.length > 1) return false;
  return true;
}

export type UseHotkeysOptions = {
  /** Top of stack first. Defaults to `["global"]`. */
  scopeStack?: HotkeyScope[];
  enabled?: boolean;
};

export function useHotkeys(hotkeys: Hotkey[], options: UseHotkeysOptions = {}): void {
  const { scopeStack = ["global"], enabled = true } = options;
  const ref = useRef(hotkeys);
  const stackRef = useRef(scopeStack);
  ref.current = hotkeys;
  stackRef.current = scopeStack;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      const typing = isTypingTarget(event.target);
      for (const scope of stackRef.current) {
        const hit = ref.current.find((hotkey) => hotkey.scopes.includes(scope) && matches(hotkey, event));
        if (!hit) continue;
        if (typing && !hit.allowInInput) return;
        event.preventDefault();
        event.stopPropagation();
        hit.run(event);
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [enabled, scopeStack.join("|")]);
}

/** Doc 06 §12.2 rule 3 — `G` chord with an 800 ms window. */
export function useChord(
  prefix: string,
  bindings: Record<string, () => void>,
  scopes: HotkeyScope[] = ["global"],
): void {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<number | null>(null);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const arm = useCallback(() => {
    setArmed(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setArmed(false), 800);
  }, []);

  const disarm = useCallback(() => {
    setArmed(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const action = bindingsRef.current[key];
      if (action) {
        event.preventDefault();
        action();
      }
      disarm();
    };
    document.addEventListener("keydown", onKeyDown, { capture: true, once: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [armed, disarm]);

  useHotkeys([{ key: prefix, scopes, run: arm }], { scopeStack: scopes });
}
