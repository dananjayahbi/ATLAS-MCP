"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/format/cn";
import { usePurgeProject, useArchiveProject } from "@/lib/api/queries";
import { errorMessage } from "@/lib/api/errors";
import { toast } from "@/hooks/use-toast";
import type { ProjectDTO } from "@/lib/types/api";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Archived projects, with restore and permanent delete.
 *
 * Archive is the reversible removal (Doc 04 §5.1), so restore is a single click.
 * Purge is the one irreversible action on this page and stays behind an inline
 * slug confirmation; the Settings dialog offers the same thing for an active
 * project.
 */

export type ArchivedProjectListProps = {
  projects: readonly ProjectDTO[];
  loading?: boolean;
  onRestored?: (project: ProjectDTO) => void;
  className?: string;
};

export function ArchivedProjectList({ projects, loading = false, onRestored, className }: ArchivedProjectListProps) {
  const restore = useArchiveProject();
  const purge = usePurgeProject();
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const doRestore = async (project: ProjectDTO) => {
    setError(null);
    try {
      const saved = await restore.mutateAsync({ slug: project.slug, archived: false });
      toast({ level: "info", title: `Project restored: ${saved.name}` });
      onRestored?.(saved);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const doPurge = async (project: ProjectDTO) => {
    setError(null);
    try {
      await purge.mutateAsync({ slug: project.slug });
      toast({ level: "warn", title: `Project deleted: ${project.name}` });
      setConfirmSlug(null);
      setTyped("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (loading && projects.length === 0) return <Skeleton lines={4} />;

  if (projects.length === 0) {
    return (
      <EmptyState
        inline
        title="No archived projects"
        hint="Archiving a project from its settings page files it here; nothing is deleted."
      />
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}

      <ul className="flex min-w-0 flex-col gap-1.5">
        {projects.map((project) => {
          const confirming = confirmSlug === project.slug;
          const busy = restore.isPending || purge.isPending;
          return (
            <li
              key={project.slug}
              className="flex min-w-0 flex-col gap-1 rounded-hud border border-grid bg-panel/70 p-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: project.accent_color }} />
                <span className="min-w-0 flex-1 truncate text-hud-body font-medium text-primary" title={project.name}>
                  {project.name}
                </span>
                <span className="shrink-0 font-machine text-hud-micro uppercase text-muted">{project.slug}</span>
                <span className="shrink-0 font-machine text-hud-micro tabular-nums text-disabled">
                  {project.archived_at ? new Date(project.archived_at).toLocaleDateString() : "—"}
                </span>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-1 font-machine text-hud-micro text-muted">
                <span className="tabular-nums">{project.counters.pending} pending</span>
                <span aria-hidden className="text-disabled">·</span>
                <span className="tabular-nums">{project.counters.completed} done</span>
                <span aria-hidden className="text-disabled">·</span>
                <span className="min-w-0 truncate" title={project.local_repo_path}>
                  {project.local_repo_path}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void doRestore(project)}
                  loading={restore.isPending && restore.variables?.slug === project.slug}
                  disabled={busy}
                >
                  Restore
                </Button>
                <Link
                  href={`/projects/${project.slug}`}
                  className="rounded-hud border border-grid px-2 py-0.5 text-hud-micro uppercase tracking-[0.06em] text-secondary hover:border-grid-strong hover:text-primary"
                >
                  Open read-only
                </Link>
                <span className="min-w-0 flex-1" />
                {confirming ? (
                  <>
                    <input
                      type="text"
                      value={typed}
                      onChange={(event) => setTyped(event.target.value)}
                      aria-label={`Type ${project.slug} to confirm deletion`}
                      placeholder={project.slug}
                      className="w-32 rounded-chip border border-grid bg-canvas px-1.5 py-0.5 font-machine text-hud-micro text-primary placeholder:text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void doPurge(project)}
                      disabled={typed.trim() !== project.slug || busy}
                      loading={purge.isPending && purge.variables?.slug === project.slug}
                    >
                      Delete permanently
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setConfirmSlug(null);
                        setTyped("");
                      }}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setConfirmSlug(project.slug);
                      setTyped("");
                    }}
                    disabled={busy}
                  >
                    Delete…
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
