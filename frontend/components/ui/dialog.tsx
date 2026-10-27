"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/format/cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/**
 * Doc 05 §8.15 / Doc 06 §16.1 — modal dialog with a focus trap, `Esc` to close and
 * a scrim. Kept presentational: callers own the form and the submit handler.
 */

export type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  width?: "sm" | "md" | "lg";
  className?: string;
};

const WIDTHS = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl" } as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  busy = false,
  width = "md",
  className,
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.offsetParent !== null,
      );
      if (items.length === 0) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      } else if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      previous?.focus?.();
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--surface-scrim)] p-4">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={() => !busy && onClose()}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[calc(100dvh-2rem)] w-full min-w-0 flex-col rounded-hud border border-grid-strong bg-panel shadow-hud-panel focus-visible:outline-none",
          WIDTHS[width],
          className,
        )}
      >
        <header className="flex shrink-0 items-baseline gap-2 border-b border-grid px-3 py-2">
          <h2 className="min-w-0 flex-1 truncate text-hud-label uppercase tracking-[0.06em] text-primary">{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy} aria-label="Close">
            ✕ <Kbd size="xs">Esc</Kbd>
          </Button>
        </header>

        {description ? <p className="shrink-0 px-3 pt-2 text-hud-micro uppercase tracking-[0.06em] text-muted">{description}</p> : null}

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">{children}</div>

        {footer ? <footer className="flex shrink-0 items-center justify-end gap-1 border-t border-grid px-3 py-2">{footer}</footer> : null}
      </div>
    </div>
  );
}
