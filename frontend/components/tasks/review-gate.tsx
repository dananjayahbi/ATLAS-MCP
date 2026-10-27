"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/format/cn";
import { errorMessage } from "@/lib/api/errors";
import { useApproveReview, useRejectReview, useReviews } from "@/lib/api/queries";
import { toast } from "@/hooks/use-toast";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { formatRelativeTime } from "@/lib/format/duration";
import { formatPriority } from "@/lib/format/priority";
import { shortTaskId } from "@/lib/format/path";
import type { TaskDetailDTO } from "@/lib/types/api";
import { PageShell } from "@/components/hud/hud-frame";
import { DodList } from "@/components/tasks/dod-list";
import { PatchViewer } from "@/components/tasks/patch-viewer";
import { ReviewActions } from "@/components/tasks/review-actions";
import { AlertBanner } from "@/components/ui/alert-banner";
import { PriorityChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Gauge } from "@/components/ui/gauge";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";

/** Doc 06 §10 — review gate: queue + tabs (Summary / Patch / Assets) + sign-off. */

type TabId = "summary" | "patch" | "assets";

function ReviewPane({ task }: { task: TaskDetailDTO }) {
  const [tab, setTab] = useState<TabId>("summary");
  const patch = task.assets.find((asset) => asset.kind === "OUTPUT_PATCH");
  const log = task.assets.find((asset) => asset.kind === "TEST_LOG");
  const images = task.assets.filter((asset) => asset.mime_type.startsWith("image/"));

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
          DoD incomplete — {task.definition_of_done.filter((item) => !item.completed).length} item(s) unchecked. Sign-off
          stays enabled (human sign-off is the only hard gate).
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

        {tab === "patch" ? <PatchViewer asset={patch ?? null} /> : null}

        {tab === "assets" ? (
          images.length === 0 ? (
            <EmptyState inline title="No verification images" />
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {images.map((asset) => (
                <li key={asset.id}>
                  <a href={asset.url} target="_blank" rel="noreferrer" className="block rounded-hud border border-grid p-1 hover:border-flow">
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

export function ReviewGate() {
  const query = useReviews();
  const approve = useApproveReview();
  const reject = useRejectReview();
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const items = query.data?.items ?? [];
  const active = items[activeIndex] ?? null;

  useKeyboardNav({
    ids: items.map((task) => task.id),
    activeIndex,
    setActiveIndex,
    onReject: () => setError("Use the reject form to supply notes (T9)."),
    extra: [
      {
        key: "Enter",
        mod: true,
        scopes: ["global"],
        allowInInput: true,
        run: () => {
          if (!active) return;
          approve.mutate(
            { id: active.id },
            {
              onSuccess: () => {
                toast({ level: "info", title: `Task ${shortTaskId(active.id)} completed` });
                setActiveIndex(0);
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
        },
      },
    ],
  });

  return (
    <PageShell
      title="Review Gate"
      subtitle={`${items.length} awaiting sign-off`}
      actions={
        <Button size="sm" onClick={() => query.refetch()}>
          Refresh
        </Button>
      }
    >
      <div className="flex min-h-0 flex-col gap-2">
        {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}

        <div className="grid min-h-0 gap-2 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Panel panelId="review-queue" title="Queue" meta={`${items.length}`}>
            {query.isLoading && !query.data ? (
              <Skeleton lines={5} />
            ) : items.length === 0 ? (
              <EmptyState inline title="Nothing awaiting sign-off" />
            ) : (
              <ul role="list" className="flex flex-col gap-0.5">
                {items.map((task, index) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      aria-current={index === activeIndex ? "true" : undefined}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-1.5 rounded-chip px-1.5 py-1 text-left",
                        index === activeIndex ? "bg-flow-tint text-flow" : "text-secondary hover:bg-raised",
                      )}
                    >
                      <span className="shrink-0 font-machine text-hud-micro">{shortTaskId(task.id)}</span>
                      <span className="min-w-0 flex-1 truncate text-hud-body">{task.title}</span>
                      <span className="shrink-0 font-machine text-hud-micro tabular-nums text-muted">
                        {formatPriority(task.priority)}
                      </span>
                    </button>
                    <p className="px-1.5 font-machine text-hud-micro text-disabled">
                      {task.project_slug} · {formatRelativeTime(task.updated_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel panelId="review-detail" title="Task" meta={active ? shortTaskId(active.id) : "—"}>
            {!active ? (
              <EmptyState title="Queue clear" hint="Submitted work appears here for sign-off." />
            ) : (
              <div className="flex min-h-0 flex-col gap-2">
                <ReviewPane task={active} />
                <ReviewActions
                  task={active}
                  onApprove={() => approve.mutateAsync({ id: active.id })}
                  onReject={(notes) => reject.mutateAsync({ id: active.id, notes })}
                />
              </div>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
