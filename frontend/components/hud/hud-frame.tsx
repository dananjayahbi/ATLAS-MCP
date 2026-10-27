import type { ReactNode } from "react";
import { cn } from "@/lib/format/cn";

/**
 * Doc 05 §8.16 / Doc 06 §5.1 — the HUD chrome: 40 px top bar, remainder fills.
 * `min-h-0` on every ancestor between the viewport and a scroll container is
 * mandatory (§7.3 item 2).
 */

export type HudFrameProps = {
  topBar: ReactNode;
  statusRail?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function HudFrame({ topBar, statusRail, children, className }: HudFrameProps) {
  return (
    <div
      className={cn(
        "relative z-10 grid h-dvh min-h-0 grid-rows-[40px_auto_minmax(0,1fr)] overflow-hidden bg-canvas font-ui text-hud-body text-primary",
        className,
      )}
    >
      <div className="z-20 border-b border-grid bg-panel/95 backdrop-blur-md" role="banner">
        {topBar}
      </div>
      {statusRail ? <div className="border-b border-grid bg-panel/70">{statusRail}</div> : null}
      <main className="min-h-0 overflow-hidden">{children}</main>
    </div>
  );
}

export type PageShellProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Shared page frame: focusable route heading (Doc 06 §16.1) + padded body. */
export function PageShell({ title, subtitle, actions, children, className }: PageShellProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <header className="flex shrink-0 items-baseline gap-3 px-4 pt-4 pb-2">
        <h1 tabIndex={-1} className="text-hud-heading font-semibold tracking-tight text-primary focus-visible:outline-none">
          {title}
        </h1>
        {subtitle ? <p className="min-w-0 flex-1 truncate text-hud-label uppercase tracking-[0.06em] text-muted">{subtitle}</p> : null}
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">{children}</div>
    </div>
  );
}
