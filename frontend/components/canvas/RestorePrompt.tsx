"use client";

/**
 * Doc 07 §13.3 — the restore prompt.
 *
 * `RESTORE` runs the already-migrated document; a stale buffer (different
 * `sourceAssetId`) offers `VIEW AS JSON` and `DISCARD` only, and `DISCARD`
 * requires an explicit second click because it is destructive.
 */
import { useState } from "react";

export interface RestorePromptProps {
  stale: boolean;
  savedAt: string | null;
  strokeCount: number;
  onRestore: () => void;
  onDiscard: () => void;
  onViewJson: () => void;
}

export function RestorePrompt(props: RestorePromptProps) {
  const [confirming, setConfirming] = useState(false);
  const when = props.savedAt ? new Date(props.savedAt).toLocaleString() : "an earlier session";

  return (
    <div
      className="absolute left-1/2 top-3 w-[min(30rem,92%)] -translate-x-1/2 rounded-[var(--radius-hud)] border p-2.5"
      role="alertdialog"
      aria-labelledby="canvas-restore-title"
      style={{
        borderColor: "var(--color-review)",
        background: "var(--surface-raised)",
        boxShadow: "var(--shadow-hud-panel)",
        zIndex: 20,
      }}
    >
      <p
        id="canvas-restore-title"
        className="font-[family-name:var(--font-machine)] text-[length:var(--text-hud-label)] tracking-[0.06em]"
        style={{ color: "var(--color-review)" }}
      >
        ⚠ UNSAVED ANNOTATION RECOVERED
      </p>
      <p className="mt-1 text-[length:var(--text-hud-body)]" style={{ color: "var(--text-secondary)" }}>
        {props.stale
          ? "This draft belongs to a different screenshot and cannot be restored."
          : `A session from ${when} (${props.strokeCount} annotation${
              props.strokeCount === 1 ? "" : "s"
            }) was never exported.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {props.stale ? null : (
          <PromptButton label="RESTORE" primary onClick={props.onRestore} />
        )}
        <PromptButton label="VIEW AS JSON" onClick={props.onViewJson} />
        <PromptButton
          label={confirming ? "CONFIRM DISCARD" : "DISCARD"}
          danger
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            props.onDiscard();
          }}
        />
      </div>
    </div>
  );
}

function PromptButton(props: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const border = props.primary
    ? "var(--color-flow)"
    : props.danger
      ? "var(--color-critical)"
      : "var(--border-grid)";
  const color = props.primary
    ? "var(--text-machine)"
    : props.danger
      ? "var(--color-critical-hot)"
      : "var(--text-secondary)";
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-[var(--radius-hud)] border px-2 py-0.5 font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)] tracking-[0.06em]"
      style={{ borderColor: border, background: "var(--surface-inset)", color }}
    >
      {props.label}
    </button>
  );
}

export default RestorePrompt;
