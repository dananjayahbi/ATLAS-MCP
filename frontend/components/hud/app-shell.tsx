"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useProjects, useTelemetry } from "@/lib/api/queries";
import type { ProjectDTO } from "@/lib/types/api";
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

function streamStateFor(generatedAt: string | undefined, failed: boolean) {
  if (failed) return "degraded" as const;
  if (!generatedAt) return "connecting" as const;
  return Date.now() - Date.parse(generatedAt) < 60_000 ? ("live" as const) : ("closed" as const);
}

export function AppShell({ children, className }: AppShellProps) {
  const pathname = usePathname() ?? "/";
  const projectsQuery = useProjects();
  const telemetryQuery = useTelemetry();
  const toggleRail = useShellStore((state) => state.toggleRail);
  const toggleCheatSheet = useShellStore((state) => state.toggleCheatSheet);

  const projects: ProjectDTO[] = projectsQuery.data?.items ?? [];
  const activeSlug = projects.find((project) => pathname.includes(`/projects/${project.slug}`))?.slug ?? projects[0]?.slug ?? null;
  const streamState = streamStateFor(telemetryQuery.data?.generated_at, telemetryQuery.isError && !telemetryQuery.data);
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
      <div id="main-content" className="h-full min-h-0">
        {children}
      </div>
    </HudFrame>
  );
}
