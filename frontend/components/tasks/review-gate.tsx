"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { useApproveReview, useRejectReview, useReviews } from "@/lib/api/queries";
import { toast } from "@/hooks/use-toast";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { shortTaskId } from "@/lib/format/path";
import { PageShell } from "@/components/hud/hud-frame";
import { ReviewActions } from "@/components/tasks/review-actions";
import { ReviewPane } from "@/components/tasks/review-pane";
import { ReviewQueue } from "@/components/tasks/review-queue";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

/** Doc 06 §10 — review gate body: queue + pane + actions, `Cmd+Enter` sign-off. */

export function ReviewGate() {
  const query = useReviews();
  const approve = useApproveReview();
  const reject = useRejectReview();
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const items = query.data?.items ?? [];
  const active = items[activeIndex] ?? null;

  const signOff = () => {
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
  };

  useKeyboardNav({
    ids: items.map((task) => task.id),
    activeIndex,
    setActiveIndex,
    onReject: () => setError("Use the reject form to supply notes — T9 requires them."),
    extra: [{ key: "Enter", mod: true, scopes: ["global"], allowInInput: true, run: signOff }],
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
        {error ? (
          <AlertBanner
            severity="warning"
            action={
              <Button size="sm" onClick={() => setError(null)}>
                Dismiss
              </Button>
            }
          >
            {error}
          </AlertBanner>
        ) : null}

        <div className="grid min-h-0 gap-2 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Panel panelId="review-queue" title="Queue" meta={`${items.length}`}>
            {query.isLoading && !query.data ? (
              <Skeleton lines={5} />
            ) : items.length === 0 ? (
              <EmptyState inline title="Nothing awaiting sign-off" />
            ) : (
              <ReviewQueue items={items} activeIndex={activeIndex} onSelect={setActiveIndex} />
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
