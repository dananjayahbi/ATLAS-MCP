"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format/cn";

/**
 * The per-task overflow menu.
 *
 * A board card cannot afford a row of action buttons next to a long status
 * badge, so archive/restore/delete live behind one disclosure pinned to the
 * card's top-right. Every entry is presentational: the caller owns the
 * confirmation and the mutation, because the guards differ per action.
 */

export type TaskActionsMenuProps = {
  taskTitle: string;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  /** Disables the disclosure while a row mutation is in flight. */
  busy?: boolean;
  className?: string;
};

export function TaskActionsMenu({
  taskTitle,
  onArchive,
  onRestore,
  onDelete,
  busy = false,
  className,
}: TaskActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, { capture: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [open]);

  const entries = [
    onArchive ? { key: "archive", label: "Archive", run: onArchive, danger: false } : null,
    onRestore ? { key: "restore", label: "Restore", run: onRestore, danger: false } : null,
    onDelete ? { key: "delete", label: "Delete…", run: onDelete, danger: true } : null,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (entries.length === 0) return null;

  return (
    <div ref={root} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${taskTitle}`}
        title="More actions"
        disabled={busy}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="shrink-0 rounded-chip px-1 font-machine text-hud-micro text-disabled hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow disabled:cursor-not-allowed disabled:opacity-40"
      >
        ⋯
      </button>

      {open ? (
        <ul
          role="menu"
          aria-label={`Actions for ${taskTitle}`}
          className="absolute right-0 top-4 z-30 w-32 rounded-hud border border-grid-strong bg-raised py-0.5 shadow-hud-panel"
        >
          {entries.map((entry) => (
            <li key={entry.key} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  entry.run();
                }}
                className={cn(
                  "block w-full px-2 py-0.5 text-left font-ui text-hud-micro uppercase tracking-[0.06em] hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow",
                  entry.danger ? "text-critical-hot" : "text-secondary",
                )}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
