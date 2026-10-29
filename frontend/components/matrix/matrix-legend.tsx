import { STATUS_META, TASK_STATUS_ORDER } from "@/lib/format/tone";

/** Doc 06 §11.6 — plot legend. Static markup, no interaction, no colour literals. */
export function MatrixLegend({ note }: { note?: string }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-hud-micro uppercase tracking-[0.06em] text-muted">
      {TASK_STATUS_ORDER.map((status) => (
        <span key={status} className="inline-flex items-center gap-1">
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: STATUS_META[status].cssVar }} />
          {STATUS_META[status].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1" title="Blocked — a blocker's Definition of Done is below 100%">
        <span aria-hidden className="size-2 rounded-full border border-critical" />
        blocked
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="size-2 rounded-full border border-dashed border-flow" />
        discovered
      </span>
      <span className="ml-auto inline-flex items-center gap-1">
        <span aria-hidden>◍</span>
        size = DoD
      </span>
      {note ? <span className="text-disabled">{note}</span> : null}
    </div>
  );
}
