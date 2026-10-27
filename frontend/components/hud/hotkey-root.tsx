"use client";

import { useShellStore } from "@/hooks/use-shell-store";
import { useHotkeys } from "@/hooks/use-hotkeys";

/** Doc 06 §12.2 rule 4 — the only component that registers global hotkeys by default. */
export function HotkeyRoot() {
  const toggleCheatSheet = useShellStore((state) => state.toggleCheatSheet);
  const toggleRail = useShellStore((state) => state.toggleRail);
  const cheatSheetOpen = useShellStore((state) => state.cheatSheetOpen);

  useHotkeys(
    [
      {
        key: "?",
        scopes: ["global"],
        run: () => toggleCheatSheet(),
      },
      {
        key: "?",
        scopes: ["modal"],
        allowInInput: true,
        run: () => toggleCheatSheet(false),
      },
      {
        key: "Escape",
        scopes: ["modal"],
        allowInInput: true,
        run: () => {
          if (cheatSheetOpen) toggleCheatSheet(false);
        },
      },
      {
        key: "b",
        mod: true,
        scopes: ["global"],
        allowInInput: true,
        run: () => toggleRail(),
      },
    ],
    { scopeStack: cheatSheetOpen ? ["modal", "global"] : ["global"] },
  );

  return null;
}
