"use client";

// Doc 09 §10.4 — one log row (T9 timestamps, T10 wrapping, §14 level chip is text
// not colour-only). ANSI-free by construction: the message arrives sanitised.
import { memo, type KeyboardEvent, type MouseEvent } from "react";
import type { LogLevel } from "@/lib/types/enums";
import type { TaskLogLine } from "@/lib/sse/types";
import { formatIso, formatTime } from "@/lib/sse/export";
import { LEVEL_COLOR, LEVEL_WEIGHT } from "./terminal-styles";

export interface LogLineProps {
  line: TaskLogLine;
  /** case-insensitive substring to wrap in `<mark>`; empty disables highlighting */
  highlight?: string;
  showTs?: boolean;
  /** invoked on click / Enter (Doc 06 jumps to the file path) */
  onClick?: (line: TaskLogLine) => void;
}

type Segment = { text: string; match: boolean };

/** Split `text` on every case-insensitive occurrence of `query`. Pure + testable. */
export function highlightSegments(text: string, query: string): Segment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const segments: Segment[] = [];
  let cursor = 0;
  for (;;) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) break;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

function renderMessage(message: string, query: string): React.ReactNode {
  const segments = highlightSegments(message, query);
  if (segments.length === 1 && !segments[0]?.match) return message;
  return segments.map((segment, index) =>
    segment.match ? (
      <mark
        key={`${index}-${segment.text}`}
        style={{ background: "var(--color-review-tint)", color: "var(--color-review-hot)" }}
      >
        {segment.text}
      </mark>
    ) : (
      <span key={`${index}-${segment.text}`}>{segment.text}</span>
    ),
  );
}

function LogLineBase({ line, highlight = "", showTs = true, onClick }: LogLineProps) {
  const isError = line.level === "ERROR";
  const isControl = line.type === "stream.reset";

  const handleClick = (): void => onClick?.(line);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick(line);
    }
  };
  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    // Clicking a row must not steal focus from the scroll container's keyboard loop.
    if (onClick) event.preventDefault();
  };

  return (
    <div
      data-log-row=""
      data-seq={line.seq}
      data-level={line.level}
      onClick={onClick ? handleClick : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      onMouseDown={onClick ? handleMouseDown : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={formatIso(line.ts)}
      // Rows live inside a single `role="log"` container; announcing each one would
      // flood a screen reader with 2 000 nodes (Doc 09 §14).
      aria-hidden={onClick ? undefined : true}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        minHeight: 18,
        padding: "0 8px",
        borderLeft: isError ? "2px solid var(--log-error)" : "2px solid transparent",
        opacity: isControl ? 0.85 : 1,
        cursor: onClick ? "pointer" : "default",
        fontFamily: "var(--font-machine)",
        fontSize: 12,
        lineHeight: "18px",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {showTs ? (
        <span
          style={{
            color: "var(--color-disabled)",
            fontVariantNumeric: "tabular-nums",
            flex: "0 0 auto",
            userSelect: "none",
          }}
        >
          {formatTime(line.ts)}
        </span>
      ) : null}
      <span
        style={{
          color: LEVEL_COLOR[line.level],
          fontWeight: LEVEL_WEIGHT[line.level],
          flex: "0 0 auto",
          width: 42,
          userSelect: "none",
        }}
      >
        {line.level}
      </span>
      <span style={{ color: "var(--text-primary)", flex: "1 1 auto", minWidth: 0 }}>
        {renderMessage(line.message, highlight)}
      </span>
    </div>
  );
}

/**
 * Memoised on `seq` + presentation props (Doc 09 §10.1). A 2 000-row window
 * re-renders only the rows whose identity actually changed.
 */
export const LogLine = memo(LogLineBase, (prev, next) => {
  return (
    prev.line.seq === next.line.seq &&
    prev.line.message === next.line.message &&
    prev.line.level === next.line.level &&
    prev.line.ts === next.line.ts &&
    prev.highlight === next.highlight &&
    prev.showTs === next.showTs &&
    prev.onClick === next.onClick
  );
});

LogLine.displayName = "LogLine";

export default LogLine;
