"use client";

import { useEffect } from "react";
import { cn } from "@/lib/format/cn";
import { TOAST_TTL_MS, useToastStore, type Toast } from "@/hooks/use-toast";

/** Doc 05 §8.11 — transient notifications, E2 elevation, reduced-motion safe. */

const LEVEL: Record<Toast["level"], string> = {
  info: "border-grid-strong text-secondary",
  warn: "border-review/40 text-review-hot",
  error: "border-critical/40 text-critical-hot",
};

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (toast.sticky) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.sticky, onDismiss]);

  return (
    <li
      data-enter="toast"
      role={toast.level === "error" ? "alert" : "status"}
      aria-live={toast.level === "error" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex w-80 items-start gap-2 rounded-hud border bg-raised/95 px-3 py-2 shadow-hud-panel backdrop-blur-md",
        LEVEL[toast.level],
      )}
    >
      <span aria-hidden className="pt-0.5">{toast.level === "error" ? "✖" : toast.level === "warn" ? "⚠" : "ℹ"}</span>
      <div className="min-w-0 flex-1">
        <p className="text-hud-label uppercase tracking-[0.06em] text-primary">{toast.title}</p>
        {toast.body ? <p className="mt-0.5 text-hud-body text-muted">{toast.body}</p> : null}
        {toast.actionLabel && toast.onAction ? (
          <button
            type="button"
            onClick={() => {
              toast.onAction?.();
              onDismiss(toast.id);
            }}
            className="mt-1 rounded-chip border border-grid px-1.5 font-machine text-hud-micro text-flow hover:border-flow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          >
            {toast.actionLabel}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded-chip px-1 text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
      >
        ✕
      </button>
    </li>
  );
}

export type ToasterProps = {
  position?: "bottom-right" | "top-right";
  className?: string;
};

export function Toaster({ position = "bottom-right", className }: ToasterProps) {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  const clear = useToastStore((state) => state.clear);

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-[60] flex flex-col gap-2",
        position === "bottom-right" ? "right-4 bottom-4" : "top-12 right-4",
        className,
      )}
    >
      <ul className="flex flex-col gap-2">
        {toasts.map((item) => (
          <ToastRow key={item.id} toast={item} onDismiss={dismiss} />
        ))}
      </ul>
      {toasts.length > 1 ? (
        <button
          type="button"
          onClick={clear}
          className="pointer-events-auto self-end rounded-chip border border-grid px-1.5 font-machine text-hud-micro text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
        >
          Dismiss all
        </button>
      ) : null}
    </div>
  );
}
