"use client";

// Doc 09 §10.2/§10.3 — search, copy/export/clear, `N new` badge, connection dot.
// Fully controlled; the parent owns the 150 ms debounce.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { chipStyle, searchStyle } from "./terminal-styles";

export interface ToolbarActionsProps {
  query: string;
  onQuery: (query: string) => void;
  onCopy: () => void;
  onExport: () => void;
  onClear: () => void;
  newCount: number;
  connected: boolean;
  onJumpToLatest?: () => void;
  /** Doc 09 §13 F11 clock-skew chip, e.g. "skew 240 ms" */
  skewLabel?: string | null;
  disabled?: boolean;
}

export function ToolbarActions({
  query,
  onQuery,
  onCopy,
  onExport,
  onClear,
  newCount,
  connected,
  onJumpToLatest,
  skewLabel = null,
  disabled = false,
}: ToolbarActionsProps) {
  const [draft, setDraft] = useState(query);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The parent owns the value; mirror it when it resets (e.g. after clear).
  useEffect(() => setDraft(query), [query]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setDraft("");
      onQuery("");
      inputRef.current?.blur();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onQuery(draft);
      event.currentTarget.blur();
    }
  };

  return (
    <>
      <label style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 1 140px", minWidth: 100 }}>
        <span aria-hidden style={{ color: "var(--text-muted)" }}>
          ⌕
        </span>
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            onQuery(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder="filter…"
          aria-label="Filter log lines"
          disabled={disabled}
          style={searchStyle}
        />
      </label>

      <div style={{ display: "flex", gap: 4 }}>
        <button type="button" onClick={onCopy} style={chipStyle} disabled={disabled} title="Copy the whole buffer">
          ⧉ copy
        </button>
        <button type="button" onClick={onExport} style={chipStyle} disabled={disabled} title="Download execution.log">
          ⇩ export
        </button>
        <button type="button" onClick={onClear} style={chipStyle} disabled={disabled} title="Clear the buffer">
          ⌫ clear
        </button>
      </div>

      {skewLabel && !connected ? (
        <span
          style={{
            color: "var(--color-review)",
            border: "1px solid var(--color-review)",
            borderRadius: "var(--radius-chip)",
            padding: "1px 5px",
          }}
          title="Clock skew between agent and orchestrator"
        >
          {skewLabel}
        </span>
      ) : null}

      {newCount > 0 ? (
        <button
          type="button"
          onClick={onJumpToLatest}
          style={{ ...chipStyle, color: "var(--color-flow)", borderColor: "var(--color-flow)" }}
          title="Jump to the newest line (End)"
        >
          ▼ {newCount} new
        </button>
      ) : null}

      <span
        aria-label={connected ? "Live stream connected" : "Live stream disconnected"}
        title={connected ? "LIVE" : "RECONNECTING"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: connected ? "var(--color-success)" : "var(--color-review)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            display: "inline-block",
            background: connected ? "var(--color-success)" : "var(--color-review)",
          }}
        />
        {connected ? "LIVE" : "RETRY"}
      </span>
    </>
  );
}

export default ToolbarActions;
