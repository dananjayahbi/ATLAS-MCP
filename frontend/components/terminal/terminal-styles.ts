// Doc 09 §10.2 — pane chrome styles. Tailwind tokens only; no hard-coded hexes
// (Doc 05 §3.2). Kept in one module so the terminal components stay small.
import type { CSSProperties } from "react";
import type { LogLevel } from "@/lib/types/enums";

export const LEVELS: readonly LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];

export const LEVEL_SHORT: Record<LogLevel, string> = {
  DEBUG: "DBG",
  INFO: "INF",
  WARN: "WRN",
  ERROR: "ERR",
};

/** Doc 09 §10.2 colour mapping. Levels resolve to the frozen `--log-*` aliases. */
export const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: "var(--log-debug)",
  INFO: "var(--log-info)",
  WARN: "var(--log-warn)",
  ERROR: "var(--log-error)",
};

export const LEVEL_WEIGHT: Record<LogLevel, number> = { DEBUG: 400, INFO: 400, WARN: 500, ERROR: 600 };

export const chipStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border-grid)",
  borderRadius: "var(--radius-chip)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontFamily: "var(--font-machine)",
  fontSize: 11,
  lineHeight: "16px",
  padding: "2px 6px",
};

export const searchStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "var(--surface-inset)",
  border: "1px solid var(--border-grid)",
  borderRadius: "var(--radius-chip)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-machine)",
  fontSize: 11,
  padding: "2px 6px",
};

export const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderBottom: "1px solid var(--border-grid)",
  fontFamily: "var(--font-machine)",
  fontSize: 11,
};

export const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  background: "var(--surface-panel)",
  border: "1px solid var(--border-grid)",
  borderRadius: "var(--radius-hud)",
  overflow: "hidden",
};

export const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "6px 8px",
  borderBottom: "1px solid var(--border-grid)",
  background: "var(--surface-raised)",
  fontFamily: "var(--font-machine)",
  fontSize: 11,
  letterSpacing: "0.06em",
  color: "var(--text-secondary)",
};

export const scrollStyle: CSSProperties = {
  position: "relative",
  flex: "1 1 auto",
  width: "100%",
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  outline: "none",
  background: "var(--surface-canvas)",
};

export const emptyStyle: CSSProperties = {
  padding: 12,
  fontFamily: "var(--font-machine)",
  fontSize: 11,
  color: "var(--text-muted)",
};

export const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "2px 8px",
  borderTop: "1px solid var(--border-grid)",
  color: "var(--text-muted)",
  fontFamily: "var(--font-machine)",
  fontSize: 10,
  fontVariantNumeric: "tabular-nums",
};

export const bannerStyle: CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid var(--border-grid)",
  background: "var(--color-review-tint)",
  color: "var(--color-review)",
  fontFamily: "var(--font-machine)",
  fontSize: 11,
};

export const badgeButtonStyle: CSSProperties = {
  position: "absolute",
  bottom: 8,
  left: "50%",
  transform: "translateX(-50%)",
  background: "var(--surface-raised)",
  border: "1px solid var(--color-flow)",
  borderRadius: "var(--radius-chip)",
  color: "var(--color-flow)",
  cursor: "pointer",
  fontFamily: "var(--font-machine)",
  fontSize: 11,
  padding: "3px 10px",
};
