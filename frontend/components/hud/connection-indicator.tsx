import { cn } from "@/lib/format/cn";

/** Doc 06 §13.5 / §16.3 — the single glanceable truth for stream + engine health. */

export type ConnectionState = "live" | "connecting" | "closed" | "degraded";

export type ConnectionIndicatorProps = {
  state: ConnectionState;
  label?: string;
  className?: string;
};

const STATE: Record<ConnectionState, { text: string; dot: string; ring: string }> = {
  live: { text: "LIVE", dot: "bg-success", ring: "border-success/40 text-success-soft" },
  connecting: { text: "CONNECTING", dot: "bg-review", ring: "border-review/40 text-review-hot" },
  closed: { text: "CLOSED", dot: "bg-disabled", ring: "border-grid text-muted" },
  degraded: { text: "DEGRADED", dot: "bg-critical", ring: "border-critical/40 text-critical-hot" },
};

export function ConnectionIndicator({ state, label, className }: ConnectionIndicatorProps) {
  const meta = STATE[state];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-chip border px-1.5 h-4 font-ui text-hud-micro uppercase tracking-[0.08em]",
        meta.ring,
        className,
      )}
      title={label ?? `Stream ${meta.text.toLowerCase()}`}
    >
      <span
        aria-hidden
        data-pulse={state === "live" ? "status" : undefined}
        className={cn("size-1.5 rounded-full", meta.dot)}
      />
      <span aria-hidden>{meta.text}</span>
      <span className="sr-only">{`Stream ${meta.text.toLowerCase()}`}</span>
      {label ? <span className="text-muted normal-case tracking-normal">{label}</span> : null}
    </span>
  );
}
