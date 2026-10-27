import type { ReactNode } from "react";
import { cn } from "@/lib/format/cn";

/** Doc 05 §8.9 — zero-data placeholder with optional action. */

export type EmptyStateProps = {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
  inline?: boolean;
  className?: string;
};

export function EmptyState({ title, hint, icon, action, inline, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        inline ? "py-4" : "h-full min-h-32 p-6",
        className,
      )}
    >
      {icon ? (
        <div className="text-disabled" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p role="status" className="text-hud-label uppercase tracking-[0.06em] text-secondary">
        {title}
      </p>
      {hint ? <p className="max-w-[46ch] text-hud-body text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}
