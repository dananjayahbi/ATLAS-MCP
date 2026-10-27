"use client";

/**
 * Doc 07 §8.4 — undo/redo mirror with `aria-keyshortcuts`, plus reorder and
 * delete so the history stack is reachable without a mouse.
 */
export interface HistoryControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  canDelete: boolean;
  disabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
}

export function HistoryControls(props: HistoryControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="History">
      <Action
        label="Undo"
        hint={props.undoLabel ?? undefined}
        shortcut="Control+Z"
        disabled={props.disabled || !props.canUndo}
        onClick={props.onUndo}
      />
      <Action
        label="Redo"
        hint={props.redoLabel ?? undefined}
        shortcut="Control+Shift+Z"
        disabled={props.disabled || !props.canRedo}
        onClick={props.onRedo}
      />
      <Action
        label="Front"
        hint="bring forward"
        shortcut="]"
        disabled={props.disabled || !props.canDelete}
        onClick={props.onBringForward}
      />
      <Action
        label="Back"
        hint="send backward"
        shortcut="["
        disabled={props.disabled || !props.canDelete}
        onClick={props.onSendBackward}
      />
      <Action
        label="Delete"
        hint="delete selection"
        shortcut="Delete"
        disabled={props.disabled || !props.canDelete}
        onClick={props.onDelete}
      />
    </div>
  );
}

function Action(props: {
  label: string;
  hint?: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.hint ? `${props.label} — ${props.hint}` : props.label}
      aria-keyshortcuts={props.shortcut}
      title={props.hint ? `${props.label} (${props.shortcut}) — ${props.hint}` : `${props.label} (${props.shortcut})`}
      className="rounded-[var(--radius-hud)] border px-1.5 py-0.5 font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)] uppercase tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        borderColor: "var(--border-grid)",
        background: "var(--surface-raised)",
        color: "var(--text-secondary)",
      }}
    >
      {props.label}
    </button>
  );
}

export default HistoryControls;
