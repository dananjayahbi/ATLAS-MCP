"use client";

// Doc 09 §10.2/§10.3 — the toolbar shell: level toggles compose with the action
// cluster. Split into two leaves so neither file carries the whole surface.
import type { LogLevel } from "@/lib/types/enums";
import { LevelFilter } from "./LevelFilter";
import { ToolbarActions } from "./ToolbarActions";
import { toolbarStyle } from "./terminal-styles";

export interface TerminalToolbarProps {
  /** enabled levels; an empty array means "all" (Doc 09 §10.3) */
  levels: readonly LogLevel[];
  onLevels: (levels: LogLevel[]) => void;
  query: string;
  onQuery: (query: string) => void;
  onCopy: () => void;
  onExport: () => void;
  onClear: () => void;
  newCount: number;
  /** connection dot: green when open + fresh, amber when retrying */
  connected?: boolean;
  /** optional jump-to-newest; the badge is still shown when omitted */
  onJumpToLatest?: () => void;
  /** Doc 09 §13 F11 clock-skew chip, e.g. "skew 240 ms" */
  skewLabel?: string | null;
  disabled?: boolean;
}

export function TerminalToolbar({
  levels,
  onLevels,
  query,
  onQuery,
  onCopy,
  onExport,
  onClear,
  newCount,
  connected = false,
  onJumpToLatest,
  skewLabel = null,
  disabled = false,
}: TerminalToolbarProps) {
  return (
    <div style={toolbarStyle}>
      <LevelFilter levels={levels} onLevels={onLevels} />
      <ToolbarActions
        query={query}
        onQuery={onQuery}
        onCopy={onCopy}
        onExport={onExport}
        onClear={onClear}
        newCount={newCount}
        connected={connected}
        onJumpToLatest={onJumpToLatest}
        skewLabel={skewLabel}
        disabled={disabled}
      />
    </div>
  );
}

export default TerminalToolbar;
