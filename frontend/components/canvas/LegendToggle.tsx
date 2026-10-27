"use client";

/**
 * Doc 07 §10.7 — legend toggle plus an editable list of `[n] → text` rows.
 *
 * The legend is the bridge between pixels and the Markdown description, so the
 * rows are editable inline and default to the auto descriptor when blank.
 */
import type { LegendItem } from "@/lib/canvas/types";

export interface LegendToggleProps {
  enabled: boolean;
  items: LegendItem[];
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onItemText: (label: number, text: string) => void;
}

export function LegendToggle(props: LegendToggleProps) {
  const hasItems = props.items.length > 0;
  return (
    <div
      className="flex flex-col gap-1.5 rounded-[var(--radius-hud)] border p-2"
      style={{ borderColor: "var(--border-grid)", background: "var(--surface-panel)" }}
    >
      <label className="flex items-center gap-2 text-[length:var(--text-hud-body)]" style={{ color: "var(--text-secondary)" }}>
        <input
          type="checkbox"
          checked={props.enabled}
          disabled={props.disabled || !hasItems}
          onChange={(event) => props.onToggle(event.target.checked)}
          aria-label="Include legend block in export"
          className="accent-[var(--color-flow)]"
        />
        <span className="font-[family-name:var(--font-machine)] uppercase tracking-[0.06em]">Legend block</span>
        <span className="ml-auto font-[family-name:var(--font-machine)]" style={{ color: "var(--text-muted)" }}>
          {props.items.length}
        </span>
      </label>

      {hasItems ? (
        <ul className="flex flex-col gap-1" aria-label="Legend rows">
          {props.items.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span
                className="shrink-0 font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)]"
                style={{ color: "var(--text-machine)" }}
              >
                [{item.label}]
              </span>
              <input
                type="text"
                value={item.text}
                maxLength={120}
                disabled={props.disabled}
                aria-label={`Legend text for annotation ${item.label}`}
                onChange={(event) => props.onItemText(item.label, event.target.value)}
                className="min-w-0 flex-1 rounded-[var(--radius-chip)] border bg-transparent px-1 py-0.5 text-[length:var(--text-hud-body)] disabled:opacity-50"
                style={{ borderColor: "var(--border-grid)", color: "var(--text-primary)" }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[length:var(--text-hud-body)]" style={{ color: "var(--text-muted)" }}>
          Number a rectangle, arrow or callout to build a legend.
        </p>
      )}
    </div>
  );
}

export default LegendToggle;
