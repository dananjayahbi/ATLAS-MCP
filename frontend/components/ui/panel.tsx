import type { ReactNode } from "react";
import { cn } from "@/lib/format/cn";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";

/** Doc 05 §8.1/§8.2 — HUD frame (1px border + corner brackets) and its 32px header. */

export type PanelState = "idle" | "loading" | "error" | "empty";

export type PanelHeaderProps = {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  sticky?: boolean;
  className?: string;
};

export function PanelHeader({ title, meta, actions, sticky = true, className }: PanelHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 border-b border-grid pb-1",
        sticky && "sticky top-0 z-10 bg-panel/95 backdrop-blur-md",
        className,
      )}
    >
      {typeof title === "string" ? (
        <h2 className="min-w-0 flex-1 truncate text-hud-label uppercase tracking-[0.06em] text-primary">{title}</h2>
      ) : (
        <div className="min-w-0 flex-1">{title}</div>
      )}
      {meta ? <span className="shrink-0 text-hud-micro tabular-nums text-muted">{meta}</span> : null}
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}

function Brackets() {
  const arm = "pointer-events-none absolute size-1.5 border-secondary";
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <span className={cn(arm, "-top-px -left-px border-t border-l")} />
      <span className={cn(arm, "-top-px -right-px border-t border-r")} />
      <span className={cn(arm, "-bottom-px -left-px border-b border-l")} />
      <span className={cn(arm, "-bottom-px -right-px border-b border-r")} />
    </span>
  );
}

export type PanelProps = {
  panelId?: string;
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  brackets?: boolean;
  scanline?: boolean;
  dense?: boolean;
  state?: PanelState;
  errorText?: string;
  emptyText?: string;
  bodyClassName?: string;
  className?: string;
  children?: ReactNode;
};

export function Panel({
  panelId,
  title,
  meta,
  actions,
  brackets = true,
  scanline = false,
  dense = false,
  state = "idle",
  errorText = "Failed to load",
  emptyText = "No data",
  bodyClassName,
  className,
  children,
}: PanelProps) {
  const label = typeof title === "string" ? title : (panelId ?? "Panel");
  return (
    <section
      aria-label={label}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col rounded-hud border border-grid bg-panel/90 shadow-hud-panel backdrop-blur-md",
        dense ? "p-2" : "p-panel",
        scanline && "hud-scanline",
        className,
      )}
    >
      {brackets ? <Brackets /> : null}
      {title || meta || actions ? <PanelHeader title={title ?? label} meta={meta} actions={actions} /> : null}
      <div className={cn("min-h-0 flex-1 overflow-auto", dense ? "pt-2" : "pt-3", bodyClassName)}>
        {state === "loading" ? (
          <Skeleton lines={3} />
        ) : state === "error" ? (
          <EmptyState inline title="Unavailable" hint={errorText} />
        ) : state === "empty" ? (
          <EmptyState inline title={emptyText} />
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** Doc 05 naming compatibility: `HudPanel` is the documented name. */
export const HudPanel = Panel;
