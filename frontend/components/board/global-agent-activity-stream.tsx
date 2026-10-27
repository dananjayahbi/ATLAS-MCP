"use client";

import { useActivityEvents } from "@/components/hud/activity-events-context";
import { cn } from "@/lib/format/cn";
import { EMPTY_EVENTS } from "@/lib/sse";
import { LOG_LEVEL_META, STATUS_META } from "@/lib/format/tone";
import { formatTime } from "@/lib/sse/export";
import type { TaskEventDTO } from "@/lib/types/api";
import { Panel } from "@/components/ui/panel";

/**
 * Doc 06 §13.2 — the cross-project activity strip. It renders the Channel A ring
 * buffer that `useProjectEvents` already maintains: 500-row cap, dedupe on
 * reconnect, and `agent.heartbeat` / `telemetry.tick` filtered out so a quiet HUD
 * is not flooded with keepalive noise.
 *
 * It is presentational on purpose — the ring lives in the SSE hook, not here, so
 * this component can be mounted anywhere without opening a second socket.
 */

export type GlobalAgentActivityStreamProps = {
  /** Override the shell ring (tests / storybook); defaults to the shared ring. */
  events?: readonly TaskEventDTO[];
  limit?: number;
  className?: string;
};

const NOISE: ReadonlySet<string> = new Set(["agent.heartbeat", "telemetry.tick"]);

export function GlobalAgentActivityStream({
  events,
  limit = 12,
  className,
}: GlobalAgentActivityStreamProps) {
  const shared = useActivityEvents();
  const source = events ?? shared ?? EMPTY_EVENTS;
  const rows = source.filter((event) => !NOISE.has(event.type)).slice(-limit).reverse();

  return (
    <Panel
      panelId="activity"
      title="Agent activity"
      meta={`${rows.length}/${source.length}`}
      className={cn("min-h-0", className)}
    >
      {rows.length === 0 ? (
        <p className="text-hud-micro uppercase tracking-[0.06em] text-disabled">
          No events yet — the stream is idle.
        </p>
      ) : (
        <ol role="log" aria-label="Agent activity" className="flex flex-col gap-0.5">
          {rows.map((event) => {
            const level = LOG_LEVEL_META[event.level];
            return (
              <li key={event.id} className="flex min-w-0 items-baseline gap-1.5">
                <span aria-hidden className={cn("shrink-0 font-machine text-hud-micro", level.className)}>
                  {level.glyph}
                </span>
                <time
                  dateTime={event.ts}
                  className="shrink-0 font-machine text-hud-micro tabular-nums text-disabled"
                >
                  {event.ts ? formatTime(event.ts) : "--:--"}
                </time>
                {event.task_id ? (
                  <span aria-hidden className="shrink-0" style={{ color: STATUS_META.PENDING.cssVar }}>
                    ·
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate font-machine text-hud-micro text-secondary" title={event.message}>
                  {event.message}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
