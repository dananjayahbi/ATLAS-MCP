"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/format/cn";
import { Badge } from "@/components/ui/badge";
import { Kbd, modKey } from "@/components/ui/kbd";
import { formatClock } from "@/lib/format/duration";
import { useClock } from "@/hooks/use-clock";
import { useLastProject } from "@/hooks/use-last-project";
import type { TelemetrySummaryDTO } from "@/lib/types/api";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ConnectionIndicator, type ConnectionState } from "./connection-indicator";
import { ProjectSwitcher } from "./project-switcher";

/** Doc 06 §5.2 — the only fixed-hue (cyan) chrome band. */

export type SystemStatus = "OPTIMAL" | "DEGRADED" | "OFFLINE";

export function deriveSystemStatus(
  healthOk: boolean,
  telemetry: TelemetrySummaryDTO | undefined,
  streamState: ConnectionState,
  now: number = Date.now(),
): SystemStatus {
  const fresh = telemetry ? now - Date.parse(telemetry.generated_at) < 60_000 : false;
  const flags = [healthOk, fresh, streamState === "live"];
  if (flags.every((flag) => !flag)) return "OFFLINE";
  return flags.every(Boolean) ? "OPTIMAL" : "DEGRADED";
}

const STATUS_CLASS: Record<SystemStatus, string> = {
  OPTIMAL: "border-success/40 bg-success-tint text-success-soft",
  DEGRADED: "border-review/40 bg-review-tint text-review-hot",
  OFFLINE: "border-critical/40 bg-critical-tint text-critical-hot",
};

export type TopBarProps = {
  projects: { slug: string; name: string; accent_color: string }[];
  activeSlug: string | null;
  status: SystemStatus;
  streamState: ConnectionState;
  discoveryCount: number;
  onToggleRail?: () => void;
  onToggleCheatSheet?: () => void;
  className?: string;
};

export function TopBar({
  projects,
  activeSlug,
  status,
  streamState,
  discoveryCount,
  onToggleRail,
  onToggleCheatSheet,
  className,
}: TopBarProps) {
  const now = useClock();
  const pathname = usePathname();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  // Doc 06 §5.2 — the Dashboard link returns to the last project dashboard, so
  // the operator never has to re-navigate through the command center.
  const lastSlug = useLastProject(activeSlug ?? projects[0]?.slug ?? null);
  const dashboardHref = lastSlug ? `/projects/${lastSlug}` : "/";
  const nav = useMemo(
    () => [
      { href: "/", label: "Command", match: (p: string) => p === "/" },
      { href: "/discoveries", label: "Triage", match: (p: string) => p.startsWith("/discoveries") },
      { href: "/reviews", label: "Reviews", match: (p: string) => p.startsWith("/reviews") },
      { href: "/archive", label: "Archive", match: (p: string) => p.startsWith("/archive") },
    ],
    [],
  );
  const onDashboard = Boolean(lastSlug) && (pathname ?? "").startsWith(`/projects/${lastSlug}`);

  return (
    <div className={cn("flex h-10 items-center gap-3 px-3", className)}>
      <button
        type="button"
        onClick={onToggleRail}
        aria-label="Toggle workspace rail"
        title={`Toggle rail (${modKey()}+B)`}
        className="grid size-6 shrink-0 place-items-center rounded-hud border border-transparent text-secondary hover:border-grid hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
      >
        <span aria-hidden>≡</span>
      </button>

      <div className="flex shrink-0 items-baseline gap-2">
        <span className="font-machine text-machine-lg font-semibold uppercase tracking-[0.14em] text-flow">ATLAS</span>
        <span className="text-hud-micro uppercase tracking-[0.1em] text-muted">Multi-Agent SOC</span>
      </div>

      <nav aria-label="Primary" className="flex min-w-0 shrink items-center gap-1">
        {nav.map((item) => {
          const active = item.match(pathname ?? "");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-chip border px-2 py-0.5 text-hud-micro uppercase tracking-[0.08em] transition-colors duration-100",
                active
                  ? "border-flow/40 bg-flow-tint text-flow"
                  : "border-transparent text-muted hover:border-grid hover:text-primary",
              )}
            >
              {item.label}
              {item.href === "/discoveries" && discoveryCount > 0 ? (
                <span className="ml-1 font-machine tabular-nums text-review-hot">{discoveryCount}</span>
              ) : null}
            </Link>
          );
        })}

        <Link
          href={dashboardHref}
          aria-current={onDashboard ? "page" : undefined}
          title={lastSlug ? `Dashboard for ${lastSlug}` : "Open the last project dashboard"}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-chip border px-2 py-0.5 text-hud-micro uppercase tracking-[0.08em] transition-colors duration-100",
            onDashboard
              ? "border-flow/40 bg-flow-tint text-flow"
              : "border-grid text-secondary hover:border-grid-strong hover:text-primary",
          )}
        >
          <span aria-hidden>▦</span>
          Dashboard
          {lastSlug ? <span className="font-machine lowercase text-muted">{lastSlug}</span> : null}
        </Link>

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          title="Create a project"
          className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-grid px-2 py-0.5 text-hud-micro uppercase tracking-[0.08em] text-secondary hover:border-grid-strong hover:text-primary"
        >
          <span aria-hidden>＋</span>
          New
        </button>
      </nav>

      <div className="min-w-0 flex-1" />

      <ProjectSwitcher projects={projects} activeSlug={activeSlug} onSelect={(slug) => router.push(`/projects/${slug}`)} />

      <span
        className={cn(
          "inline-flex h-4 shrink-0 items-center gap-1 rounded-chip border px-1.5 font-ui text-hud-micro uppercase tracking-[0.08em]",
          STATUS_CLASS[status],
        )}
        title={`System status: ${status}`}
      >
        <span aria-hidden>{status === "OPTIMAL" ? "●" : status === "DEGRADED" ? "▲" : "✕"}</span>
        SYS: {status}
      </span>

      <ConnectionIndicator state={streamState} />

      <time
        dateTime={now?.toISOString() ?? ""}
        title={now?.toISOString() ?? "Local time"}
        suppressHydrationWarning
        className="hidden shrink-0 font-machine text-machine-sm tabular-nums text-secondary sm:block"
      >
        {now ? formatClock(now) : "--:--:--"}
      </time>

      <Link
        href="/discoveries"
        aria-label={`Triage inbox, ${discoveryCount} awaiting`}
        className="hidden shrink-0 items-center gap-1 rounded-chip border border-review/40 bg-review-tint px-1.5 text-hud-micro uppercase text-review-hot hover:border-review md:inline-flex"
      >
        <span aria-hidden>⚡</span>
        <span className="font-machine tabular-nums">{discoveryCount}</span>
        <span>Awaiting</span>
      </Link>

      <button
        type="button"
        onClick={onToggleCheatSheet}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        className="hidden shrink-0 items-center gap-1 rounded-hud border border-grid px-1 text-secondary hover:border-grid-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow sm:flex"
      >
        <Kbd>?</Kbd>
      </button>

      <Badge tone="flow" className="hidden lg:inline-flex">
        v1.0.0
      </Badge>

      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
