"use client";

// Doc 09 §10.4 T1/T11 — the windowed list body. Owns only the slice maths and the
// scroll container; the shell owns state, the toolbar, and the shared element ref.
import { useMemo, type KeyboardEvent } from "react";
import type { LogLevel } from "@/lib/types/enums";
import type { TaskLogLine } from "@/lib/sse/types";
import { LogLine } from "./LogLine";
import { ROW_H, useVirtualWindow } from "./use-virtual-window";
import { emptyStyle, scrollStyle } from "./terminal-styles";

/** Case-insensitive substring match over message + level (T6). */
export function matchesQuery(line: TaskLogLine, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return line.message.toLowerCase().includes(needle) || line.level.toLowerCase().includes(needle);
}

/** Level filter then text query - the two compose with AND and keep `seq` order (T5/T6). */
export function filterLines(
  lines: readonly TaskLogLine[],
  levels: readonly LogLevel[],
  query: string,
): readonly TaskLogLine[] {
  const byLevel = levels.length === 0 ? lines : lines.filter((line) => levels.includes(line.level));
  if (!query) return byLevel;
  return byLevel.filter((line) => matchesQuery(line, query));
}

export interface LogViewportProps {
  lines: readonly TaskLogLine[];
  highlight: string;
  showTs: boolean;
  connected: boolean;
  /** shared with `useAutoscroll` - exactly one scroll container per pane */
  ref: React.RefObject<HTMLDivElement | null>;
  onEnd(): void;
  onHome(): void;
  onLineClick?: (line: TaskLogLine) => void;
}

export function LogViewport({
  lines,
  highlight,
  showTs,
  connected,
  ref,
  onEnd,
  onHome,
  onLineClick,
}: LogViewportProps) {
  const virtual = useVirtualWindow({ count: lines.length, ref });

  const windowed = useMemo(
    () => lines.slice(virtual.start, virtual.end),
    [lines, virtual.start, virtual.end],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Doc 09 §14 keyboard contract: End resumes autoscroll (T4), Home goes to oldest.
    if (event.key === "End") {
      event.preventDefault();
      onEnd();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onHome();
      return;
    }
    if (event.key === "PageDown" || event.key === "PageUp") {
      const delta = event.currentTarget.clientHeight * (event.key === "PageDown" ? 1 : -1);
      event.currentTarget.scrollTop += delta;
    }
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Agent log output"
      onKeyDown={handleKeyDown}
      style={scrollStyle}
    >
      {lines.length === 0 ? (
        <div style={emptyStyle}>
          {connected ? "waiting for agent output..." : "orchestrator unreachable - reconnecting..."}
        </div>
      ) : (
        <div style={{ height: virtual.totalHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${virtual.offsetY}px)`, willChange: "transform" }}>
            {windowed.map((line) => (
              <LogLine
                key={line.seq > 0 ? `seq-${line.seq}` : `ctrl-${line.id ?? line.ts}-${line.message.length}`}
                line={line}
                highlight={highlight}
                showTs={showTs}
                onClick={onLineClick}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { ROW_H };
