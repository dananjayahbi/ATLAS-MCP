"use client";

import { useState } from "react";
import Link from "next/link";
import { useArchivedProjects } from "@/lib/api/queries";
import { PageShell } from "@/components/hud/hud-frame";
import { ArchivedProjectList } from "@/components/projects/archived-project-list";
import { ArchivedTaskSections } from "@/components/tasks/archived-task-list";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";

/**
 * `/archive` — everything the operator filed away, with restore.
 *
 * Two tabs on purpose. Projects and tasks archive for different reasons (a
 * finished engagement vs. a mis-filed ticket) and restore into different places
 * (the rail vs. the queue), so one merged list would have to explain both.
 */

type ArchiveTab = "projects" | "tasks";

const TABS = [
  { id: "projects", label: "Projects" },
  { id: "tasks", label: "Tasks" },
] as const;

export function ArchiveOverview() {
  const archivedProjects = useArchivedProjects();
  const [tab, setTab] = useState<ArchiveTab>("projects");
  const projects = archivedProjects.data?.items ?? [];

  return (
    <PageShell
      title="Archive"
      subtitle={`${projects.length} archived project${projects.length === 1 ? "" : "s"} · restorable, never lost`}
      actions={
        <>
          <Tabs items={[...TABS]} value={tab} onChange={(id) => setTab(id as ArchiveTab)} />
          <Button size="sm" onClick={() => void archivedProjects.refetch()}>
            Refresh
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-col gap-3">
        {tab === "projects" ? (
          <Panel
            panelId="archive-projects"
            title="Archived projects"
            meta={archivedProjects.isFetching ? "syncing" : `${projects.length} rows`}
            state={archivedProjects.isLoading && projects.length === 0 ? "loading" : "idle"}
          >
            <ArchivedProjectList
              projects={projects}
              loading={archivedProjects.isLoading}
              onRestored={() => void archivedProjects.refetch()}
            />
          </Panel>
        ) : (
          <Panel
            panelId="archive-tasks"
            title="Archived tasks"
            meta="per project"
            state="idle"
            bodyClassName="pt-1"
          >
            <ArchivedTaskSections />
          </Panel>
        )}

        <p className="text-hud-micro text-disabled">
          Nothing on this page is destroyed by archiving.{" "}
          <Link href="/" className="hover:text-primary">
            Back to the command center
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
