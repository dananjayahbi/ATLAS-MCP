"use client";

import { useState } from "react";
import type { TaskDetailDTO } from "@/lib/types/api";
import { DodList } from "@/components/tasks/dod-list";
import { PatchViewer } from "@/components/tasks/patch-viewer";
import { AlertBanner } from "@/components/ui/alert-banner";
import { PriorityChip } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Gauge } from "@/components/ui/gauge";
import { Tabs } from "@/components/ui/tabs";
import { shortTaskId } from "@/lib/format/path";

/** Doc 06 §10.2–§10.4 — one task under review: header, DoD, tabs, patch viewer. */

type TabId = "summary" | "patch" | "assets";

export function ReviewPane({ task }: { task: TaskDetailDTO }) {
  const [tab, setTab] = useState<TabId>("summary");
  const patch = task.assets.find((asset) => asset.kind === "OUTPUT_PATCH") ?? null;
  const log = task.assets.find((asset) => asset.kind === "TEST_LOG");
  const images = task.assets.filter((asset) => asset.mime_type.startsWith("image/"));
  const unchecked = task.definition_of_done.filter((item) => !item.completed).length;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-machine text-hud-micro uppercase text-disabled">{shortTaskId(task.id)}</span>
        <h2 className="min-w-0 flex-1 truncate text-hud-title text-primary">{task.title}</h2>
        <PriorityChip priority={task.priority} showLabel />
      </div>

      <Gauge value={task.dod_progress_percent} items={task.definition_of_done} label="Definition of done" />

      {task.dod_progress_percent < 100 ? (
        <AlertBanner severity="warning">
          DoD incomplete — {unchecked} item(s) unchecked. Sign-off stays enabled (human sign-off is the only hard gate).
        </AlertBanner>
      ) : null}

      <Tabs
        items={[
          { id: "summary", label: "Summary" },
          { id: "patch", label: "Patch" },
          { id: "assets", label: "Assets" },
        ]}
        value={tab}
        onChange={(id) => setTab(id as TabId)}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "summary" ? (
          <div className="flex flex-col gap-2">
            {task.review_summary ? (
              <p className="text-hud-body text-secondary">{task.review_summary}</p>
            ) : (
              <p className="text-hud-body text-muted">No review summary supplied.</p>
            )}
            <DodList items={task.definition_of_done} />
          </div>
        ) : null}

        {tab === "patch" ? <PatchViewer asset={patch} /> : null}

        {tab === "assets" ? (
          images.length === 0 ? (
            <EmptyState inline title="No verification images" />
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {images.map((asset) => (
                <li key={asset.id}>
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-hud border border-grid p-1 hover:border-flow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.url} alt={asset.filename} className="h-40 w-full object-contain" />
                    <span className="mt-1 block truncate font-machine text-hud-micro text-muted">{asset.filename}</span>
                  </a>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {log ? (
          <p className="mt-2 font-machine text-hud-micro text-disabled">
            verification log: {log.filename} ({log.byte_size} B)
          </p>
        ) : null}
      </div>
    </div>
  );
}
