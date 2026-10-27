"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/format/cn";
import { formatDuration } from "@/lib/format/duration";
import { middlePath } from "@/lib/format/path";
import { HEALTH_CLASS, healthTone } from "@/lib/format/tone";
import type { ProjectDTO } from "@/lib/types/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gauge } from "@/components/ui/gauge";
import { MachineText } from "@/components/ui/machine-text";
import { Skeleton } from "@/components/ui/skeleton";

/** Doc 06 §6 — workspace rail cards; the only place `local_repo_path` is shown. */

export type WorkspaceRailProps = {
  projects: readonly ProjectDTO[];
  loading?: boolean;
  className?: string;
};

export type ProjectStatus = "ACTIVE" | "IDLE" | "OPTIMAL" | "ARCHIVED";

export function deriveProjectStatus(project: ProjectDTO): ProjectStatus {
  if (project.archived_at !== null) return "ARCHIVED";
  if (project.counters.in_progress > 0) return "ACTIVE";
  if (project.active_agent_id === null) return "IDLE";
  return project.counters.health_percent >= 90 && project.counters.in_review === 0 ? "OPTIMAL" : "ACTIVE";
}

const MINUTE = 60;
const STALE_AFTER = 10 * MINUTE;

function RailCard({
  project,
  active,
  onSelect,
}: {
  project: ProjectDTO;
  active: boolean;
  onSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const status = deriveProjectStatus(project);
  const stale = project.last_event_at ? Date.now() - Date.parse(project.last_event_at) > STALE_AFTER * 1000 : false;

  return (
    <li
      className={cn(
        "group relative rounded-hud border bg-panel/80 transition-colors duration-100",
        active ? "border-flow/50" : "border-grid hover:border-grid-strong",
        stale && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full min-w-0 flex-col gap-1 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: project.accent_color }} />
          <span className="min-w-0 flex-1 truncate font-machine text-machine-md uppercase tracking-[0.08em] text-flow">
            {project.slug}
          </span>
          <Badge tone={status === "ARCHIVED" ? "neutral" : status === "ACTIVE" ? "flow" : "success"}>{status}</Badge>
          <span className={cn("shrink-0 font-machine text-machine-sm tabular-nums", HEALTH_CLASS[healthTone(project.counters.health_percent)])}>
            {project.counters.health_percent}%
          </span>
        </span>

        <Gauge
          value={project.counters.health_percent}
          segments={20}
          size="sm"
          showLabel={false}
          tone="health"
          label={`${project.slug} health`}
        />

        <MachineText truncate="middle" dim className="text-hud-micro">
          {middlePath(project.local_repo_path, 26)}
        </MachineText>

        <span className="flex min-w-0 items-center gap-1 font-machine text-hud-micro text-muted">
          <span className="min-w-0 flex-1 truncate" title={project.active_agent_id ?? "no active agent"}>
            {project.active_agent_id ?? "—"}
          </span>
          <span className="shrink-0 tabular-nums">PEND {project.counters.pending}</span>
          <span aria-hidden className="text-disabled">
            ·
          </span>
          <span className="shrink-0 tabular-nums">REV {project.counters.in_review}</span>
        </span>
      </button>

      <div className="flex items-center gap-1 border-t border-grid px-2 py-1">
        <Link
          href={`/projects/${project.slug}`}
          className="rounded-chip px-1 font-machine text-hud-micro uppercase text-secondary hover:text-flow"
        >
          Board
        </Link>
        <Link
          href={`/projects/${project.slug}?view=matrix`}
          className="rounded-chip px-1 font-machine text-hud-micro uppercase text-secondary hover:text-flow"
        >
          Matrix
        </Link>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(project.local_repo_path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-chip px-1 font-machine text-hud-micro uppercase text-disabled hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
          aria-label={`Copy ${project.slug} root path`}
        >
          {copied ? "copied" : "path"}
        </button>
      </div>
    </li>
  );
}

export function WorkspaceRail({ projects, loading = false, className }: WorkspaceRailProps) {
  const pathname = usePathname() ?? "";
  const activeSlug = projects.find((project) => pathname.includes(`/projects/${project.slug}`))?.slug ?? null;

  if (loading && projects.length === 0) {
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <Skeleton lines={3} />
        <Skeleton lines={3} />
        <Skeleton lines={3} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <p className="text-hud-body text-muted">No projects registered yet.</p>
        <Button size="sm">Create project</Button>
      </div>
    );
  }

  return (
    <nav aria-label="Active workspaces" className={cn("flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1", className)}>
      <div className="flex shrink-0 items-center justify-between px-0.5">
        <h2 className="text-hud-micro uppercase tracking-[0.08em] text-muted">Active workspaces</h2>
        <span className="font-machine text-hud-micro tabular-nums text-disabled">
          {projects.filter((p) => p.counters.in_progress > 0).length}/{projects.length} running
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {projects.map((project) => (
          <RailCard
            key={project.slug}
            project={project}
            active={project.slug === activeSlug}
            onSelect={() => {
              window.location.assign(`/projects/${project.slug}`);
            }}
          />
        ))}
      </ul>
      <p className="shrink-0 px-0.5 text-hud-micro uppercase tracking-[0.06em] text-disabled">
        Lease TTL {formatDuration(900)} · heartbeat 120s
      </p>
    </nav>
  );
}
