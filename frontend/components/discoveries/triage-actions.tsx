"use client";

import { cn } from "@/lib/format/cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/** Doc 06 §9.5 — the "N pending, undo available" shelf above the inbox. */

export type ShelfEntry = {
  taskId: string;
  kind: "approve" | "reject";
  title: string;
  expiresAt: number;
};

export type TriageActionsProps = {
  entries: ShelfEntry[];
  now: number;
  onUndo: (taskId: string) => void;
  awaiting: number;
  className?: string;
};

export function TriageActions({ entries, now, onUndo, awaiting, className }: TriageActionsProps) {
  return (
    <div className={cn("flex shrink-0 flex-wrap items-center gap-2", className)}>
      <span className="rounded-chip border border-review/40 bg-review-tint px-1.5 font-ui text-hud-micro uppercase tracking-[0.08em] text-review-hot">
        {awaiting} awaiting
      </span>

      <span className="inline-flex items-center gap-1 text-hud-micro uppercase tracking-[0.06em] text-muted">
        <Kbd>A</Kbd>approve <Kbd>E</Kbd>edit <Kbd>Del</Kbd>dismiss <Kbd>U</Kbd>undo
      </span>

      <span className="min-w-0 flex-1" />

      {entries.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1" aria-label="Pending triage actions (undoable)">
          {entries.map((entry) => {
            const remaining = Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
            return (
              <li key={`${entry.taskId}-${entry.kind}`}>
                <span className="inline-flex items-center gap-1 rounded-chip border border-flow/40 bg-flow-tint px-1.5 py-0.5 text-hud-micro text-flow">
                  <span className="font-machine uppercase">{entry.kind === "approve" ? "APPROVED" : "DISMISSED"}</span>
                  <span className="max-w-40 truncate text-secondary" title={entry.title}>
                    {entry.title}
                  </span>
                  <span className="font-machine tabular-nums text-machine">{remaining}s</span>
                  <Button size="sm" variant="ghost" onClick={() => onUndo(entry.taskId)}>
                    Undo <Kbd size="xs">U</Kbd>
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
