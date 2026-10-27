"use client";

// Doc 09 §10.2/§14 — level filter toggles. The chip is always text (`WARN`), never
// colour-only, so it passes WCAG 1.4.1.
import type { LogLevel } from "@/lib/types/enums";
import { LEVELS, LEVEL_COLOR, LEVEL_SHORT, chipStyle } from "./terminal-styles";

export interface LevelFilterProps {
  /** enabled levels; an empty array means "all" */
  levels: readonly LogLevel[];
  onLevels: (levels: LogLevel[]) => void;
}

export function enabledLevels(levels: readonly LogLevel[], level: LogLevel): boolean {
  return levels.length === 0 || levels.includes(level);
}

/** Toggle one level; emptying the set is normalised back to "all" by the caller. */
export function toggleLevel(levels: readonly LogLevel[], level: LogLevel): LogLevel[] {
  return enabledLevels(levels, level)
    ? levels.filter((entry) => entry !== level)
    : [...levels, level];
}

export function LevelFilter({ levels, onLevels }: LevelFilterProps) {
  const all = levels.length === 0;

  return (
    <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Log level filter">
      <button
        type="button"
        onClick={() => onLevels([])}
        aria-pressed={all}
        style={{
          ...chipStyle,
          color: all ? "var(--color-flow)" : "var(--text-muted)",
          borderColor: all ? "var(--color-flow)" : "var(--border-grid)",
        }}
      >
        ALL
      </button>
      {LEVELS.map((level) => {
        const active = enabledLevels(levels, level);
        return (
          <button
            key={level}
            type="button"
            onClick={() => onLevels(toggleLevel(levels, level))}
            aria-pressed={active}
            aria-label={`${level} level`}
            title={`Toggle ${level}`}
            style={{
              ...chipStyle,
              color: active ? LEVEL_COLOR[level] : "var(--text-disabled)",
              borderColor: active ? LEVEL_COLOR[level] : "var(--border-grid)",
              opacity: active ? 1 : 0.6,
            }}
          >
            {LEVEL_SHORT[level]}
          </button>
        );
      })}
    </div>
  );
}

export default LevelFilter;
