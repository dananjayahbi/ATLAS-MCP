import type { ReactNode } from "react";
import { cn } from "@/lib/format/cn";

/** Doc 05 §8.15 — degraded-mode banner (Doc 06 §16.3). */

export type AlertBannerProps = {
  children: ReactNode;
  severity?: "info" | "warning" | "critical";
  action?: ReactNode;
  className?: string;
};

const SEVERITY: Record<NonNullable<AlertBannerProps["severity"]>, string> = {
  info: "border-grid-strong bg-raised text-secondary",
  warning: "border-review/40 bg-review-tint text-review-hot",
  critical: "border-critical/40 bg-critical-tint text-critical-hot",
};

export function AlertBanner({ children, severity = "warning", action, className }: AlertBannerProps) {
  return (
    <div
      role={severity === "critical" ? "alert" : "status"}
      aria-live={severity === "critical" ? "assertive" : "polite"}
      className={cn(
        "flex items-center gap-2 rounded-hud border px-3 py-1.5 text-hud-label uppercase tracking-[0.06em]",
        SEVERITY[severity],
        className,
      )}
    >
      <span aria-hidden>{severity === "critical" ? "✖" : severity === "warning" ? "⚠" : "ℹ"}</span>
      <span className="min-w-0 flex-1 truncate normal-case tracking-normal">{children}</span>
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}
