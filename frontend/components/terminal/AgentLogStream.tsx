"use client";

// Doc 09 §10.1/§10.4 — the pane shell. Header, toolbar, windowed list, empty /
// disconnected / reset states, autoscroll wiring, `role="log"` + `aria-live`.
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type RefCallback } from "react";
import type { LogLevel } from "@/lib/types/enums";
import { copyLog } from "@/lib/sse/export";
import { useTaskLogStream } from "@/lib/sse/hooks/use-task-log-stream";
import type { TaskLogLine } from "@/lib/sse/types";
import { LogViewport, filterLines } from "./LogViewport";
import { TerminalToolbar } from "./TerminalToolbar";
import { useAutoscroll } from "./use-autoscroll";
import { ROW_H } from "./use-virtual-window";
import { badgeButtonStyle, bannerStyle, footerStyle, headerStyle, panelStyle } from "./terminal-styles";

/** Doc 09 §10.3 — the published component contract (frozen). */
export interface AgentLogStreamProps {
  taskId: string;
  /** CSS length; default `"100%"` */
  height?: string;
  /** default `"LIVE AGENT LOG STREAM"` */
  title?: string;
  className?: string;
  onLineClick?: (line: TaskLogLine) => void;
  /** toolbar-toggleable; default true */
  showTs?: boolean;
  /** empty = all four (Doc 09 §10.3) */
  initialLevels?: readonly LogLevel[];
}

export function AgentLogStream({
  taskId,
  height = "100%",
  title = "LIVE AGENT LOG STREAM",
  className,
  onLineClick,
  showTs = true,
  initialLevels = [],
}: AgentLogStreamProps) {
  const stream = useTaskLogStream(taskId);
  const [levels, setLevels] = useState<readonly LogLevel[]>(initialLevels);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  // `useDeferredValue` keeps typing responsive over 2 000 rows (Doc 09 §12).
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(
    () => filterLines(stream.lines, levels, deferredQuery),
    [stream.lines, levels, deferredQuery],
  );

  const autoscroll = useAutoscroll({ lineCount: filtered.length });
  const { setAtBottom, resume, scrollToBottom } = autoscroll;
  const streamSetAtBottom = stream.setAtBottom;
  const streamResume = stream.resume;

  // Report scroll position upward so the hook's own `paused`/`newCount` agree (T3).
  useEffect(() => {
    streamSetAtBottom(!autoscroll.paused);
  }, [autoscroll.paused, streamSetAtBottom]);

  const jumpToLatest = useCallback(() => {
    scrollToBottom();
    streamResume();
    resume();
  }, [scrollToBottom, streamResume, resume]);

  const handleCopy = useCallback(() => {
    void copyLog(filtered).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [filtered]);

  const handleClear = useCallback(() => {
    stream.clear();
    jumpToLatest();
  }, [stream, jumpToLatest]);

  // The viewport needs a ref callback rather than a ref object to share the element.
  const attachRef: RefCallback<HTMLDivElement> = useCallback(
    (element) => {
      autoscroll.ref.current = element;
    },
    [autoscroll.ref],
  );

  const newCount = Math.max(stream.newCount, autoscroll.newCount);
  const shown = stream.lines.length;
  const gaps = stream.gapCount;

  return (
    <section
      className={className}
      aria-label={title}
      style={{ ...panelStyle, height }}
    >
      <header style={headerStyle}>
        <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{title}</span>
        <span style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-muted)" }}>
          <span title={taskId}>{taskId.slice(0, 8)}</span>
          {gaps > 0 ? (
            <span style={{ color: "var(--color-review)" }} title="Sequence gaps detected">
              ⋯ {gaps} gap{gaps === 1 ? "" : "s"}
            </span>
          ) : null}
          {copied ? <span style={{ color: "var(--color-success)" }}>✓ copied</span> : null}
        </span>
      </header>

      <TerminalToolbar
        levels={levels as LogLevel[]}
        onLevels={(next) => setLevels(next)}
        query={query}
        onQuery={setQuery}
        onCopy={handleCopy}
        onExport={stream.export}
        onClear={handleClear}
        newCount={newCount}
        connected={stream.connected}
        onJumpToLatest={jumpToLatest}
      />

      {stream.resetReason !== null ? (
        <div role="status" style={bannerStyle}>
          stream gap ({stream.resetReason}) — refetching history…
        </div>
      ) : null}

      <LogViewport
        lines={filtered}
        highlight={deferredQuery}
        showTs={showTs}
        connected={stream.connected}
        attachRef={attachRef}
        onEnd={jumpToLatest}
        onHome={() => {
          autoscroll.ref.current?.scrollTo({ top: 0 });
        }}
        onLineClick={onLineClick}
      />

      <div style={{ position: "relative", height: 0 }}>
        {newCount > 0 ? (
          <button type="button" onClick={jumpToLatest} style={badgeButtonStyle}>
            ▼ {newCount} new
          </button>
        ) : null}
      </div>

      <footer style={footerStyle}>
        <span>
          {filtered.length} shown · {shown} buffered
        </span>
        <span>{ROW_H}px rows</span>
      </footer>
    </section>
  );
}

export default AgentLogStream;
