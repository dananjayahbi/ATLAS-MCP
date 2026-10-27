"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/format/cn";
import { Kbd, modKey } from "@/components/ui/kbd";
import { useShellStore } from "@/hooks/use-shell-store";

/** Doc 06 §12.3 — contextual cheat sheet (`role="dialog"`, `aria-modal`). */

type Row = { keys: string[]; action: string; scope: string };

const ROWS: Row[] = [
  { keys: ["j"], action: "Next item", scope: "lists" },
  { keys: ["k"], action: "Previous item", scope: "lists" },
  { keys: ["Enter"], action: "Open focused task", scope: "lists" },
  { keys: ["a"], action: "Approve focused discovery", scope: "triage" },
  { keys: ["r"], action: "Reject / open reject notes", scope: "triage · review" },
  { keys: [modKey(), "Enter"], action: "Sign off review", scope: "review" },
  { keys: ["x"], action: "Toggle matrix X axis", scope: "matrix" },
  { keys: ["+"], action: "Zoom in", scope: "matrix" },
  { keys: ["-"], action: "Zoom out", scope: "matrix" },
  { keys: ["0"], action: "Reset matrix view", scope: "matrix" },
  { keys: ["g", "b"], action: "Go to command center", scope: "global" },
  { keys: ["g", "d"], action: "Go to discoveries", scope: "global" },
  { keys: ["g", "r"], action: "Go to reviews", scope: "global" },
  { keys: ["/"], action: "Focus search", scope: "global" },
  { keys: ["?"], action: "Toggle this sheet", scope: "global" },
  { keys: ["Esc"], action: "Dismiss overlay → clear → blur", scope: "global" },
  { keys: [modKey(), "B"], action: "Toggle workspace rail", scope: "global" },
];

export function CheatSheet() {
  const open = useShellStore((state) => state.cheatSheetOpen);
  const toggle = useShellStore((state) => state.toggleCheatSheet);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-6" role="presentation">
      <button
        type="button"
        aria-label="Close keyboard shortcuts"
        onClick={() => toggle(false)}
        className="absolute inset-0 cursor-default bg-[var(--surface-scrim)]"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cheatsheet-title"
        tabIndex={-1}
        className={cn(
          "relative z-10 w-full max-w-xl rounded-hud border border-grid-strong bg-raised p-4 shadow-hud-panel focus-visible:outline-none",
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="cheatsheet-title" className="text-hud-label uppercase tracking-[0.06em] text-primary">
            Keyboard map
          </h2>
          <button
            type="button"
            onClick={() => toggle(false)}
            className="rounded-chip border border-grid px-1.5 font-machine text-hud-micro text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          >
            Esc
          </button>
        </div>
        <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {ROWS.map((row) => (
            <div key={`${row.keys.join("+")}-${row.action}`} className="flex items-center gap-2 rounded-chip px-1 py-0.5">
              <dt className="flex shrink-0 items-center gap-1">
                {row.keys.map((key) => (
                  <Kbd key={key} size="sm">
                    {key}
                  </Kbd>
                ))}
              </dt>
              <dd className="min-w-0 flex-1 truncate text-hud-body text-secondary">{row.action}</dd>
              <dd className="shrink-0 text-hud-micro uppercase text-disabled">{row.scope}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
