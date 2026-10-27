"use client";

import type { ReactNode } from "react";
import { useProjects, useTelemetry } from "@/lib/api/queries";
import { useProjectEvents } from "@/lib/sse";
import type { ProjectDTO } from "@/lib/types/api";
import { useActiveProjectSlug } from "@/hooks/use-active-project-slug";
import { ActivityEventsProvider } from "./activity-events-context";
import { HudFrame } from "./hud-frame";
import { StatusRail } from "./status-rail";
import { TopBar, deriveSystemStatus } from "./top-bar";
import { useShellStore } from "@/hooks/use-shell-store";

/**
 * Doc 06 §5 — the client chrome boundary. Pages render inside it; the frame itself
 * holds no server data beyond the two shell queries.
 */

export type AppShellProps = {
  children: ReactNode;
  className?: string;
};

function streamStateFor(connected: boolean, failed: boolean) {
  if (failed) return "degraded" as const;
  return connected ? ("live" as const) : ("connecting" as const);
}

export function AppShell({ children, className }: AppShellProps) {
  const projectsQuery = useProjects();
  const telemetryQuery = useTelemetry();
  const toggleRail = useShellStore((state) => state.toggleRail);
  const toggleCheatSheet = useShellStore((state) => state.toggleCheatSheet);

  const projects: ProjectDTO[] = projectsQuery.data?.items ?? [];
  const activeSlug = useActiveProjectSlug();
  // Doc 09 §11.1 — the single Channel A subscription for the whole shell. Every
  // event patches the TanStack cache through `invalidationKeys`, so pages do not
  // each open their own EventSource.
  const events = useProjectEvents(activeSlug ?? "");
  const streamState = streamStateFor(events.connected, Boolean(events.resetReason));
  const status = deriveSystemStatus(!projectsQuery.isError, telemetryQuery.data, streamState);

  return (
    <HudFrame
      className={className}
      statusRail={<StatusRail telemetry={telemetryQuery.data ?? null} />}
      topBar={
        <TopBar
          projects={projects.map((project) => ({ slug: project.slug, name: project.name, accent_color: project.accent_color }))}
          activeSlug={activeSlug}
          status={status}
          streamState={streamState}
          discoveryCount={telemetryQuery.data?.discoveries_pending ?? 0}
          onToggleRail={toggleRail}
          onToggleCheatSheet={() => toggleCheatSheet()}
        />
      }
    >
      <ActivityEventsProvider events={events.events}>
        <div id="main-content" className="h-full min-h-0">
          {children}
        </div>
      </ActivityEventsProvider>
    </HudFrame>
  );
}
