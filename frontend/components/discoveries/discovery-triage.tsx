"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { useApproveDiscovery, useDiscoveries, useRejectDiscovery } from "@/lib/api/queries";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { DiscoveryDTO } from "@/lib/types/api";
import { PageShell } from "@/components/hud/hud-frame";
import { DiscoveryInbox } from "@/components/discoveries/discovery-inbox";
import { PrioritySlider } from "@/components/tasks/priority-slider";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/** Doc 06 §9 — `/discoveries` triage inbox. */

export function DiscoveryTriage() {
  const query = useDiscoveries();
  const approve = useApproveDiscovery();
  const reject = useRejectDiscovery();
  const [editing, setEditing] = useState<DiscoveryDTO | null>(null);
  const [draftPriority, setDraftPriority] = useState(85);
  const [error, setError] = useState<string | null>(null);

  const items = query.data?.items ?? [];

  useHotkeys(
    [
      {
        key: "Escape",
        scopes: ["modal"],
        allowInInput: true,
        run: () => setEditing(null),
      },
    ],
    { scopeStack: editing ? ["modal", "global"] : ["global"] },
  );

  return (
    <PageShell
      title="Triage Inbox"
      subtitle="Agent-discovered tasks awaiting your approval"
      actions={
        <Button size="sm" onClick={() => query.refetch()}>
          Refresh
        </Button>
      }
    >
      <div className="flex min-h-0 flex-col gap-2">
        {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}

        <DiscoveryInbox
          discoveries={items}
          loading={query.isLoading}
          onEditPriority={(discovery) => {
            setDraftPriority(discovery.priority);
            setEditing(discovery);
          }}
          onApprove={async (discovery, priority) => {
            try {
              await approve.mutateAsync({ id: discovery.task_id, priority });
            } catch (err) {
              setError(errorMessage(err));
              throw err;
            }
          }}
          onReject={async (discovery) => {
            try {
              await reject.mutateAsync({ id: discovery.task_id });
            } catch (err) {
              setError(errorMessage(err));
              throw err;
            }
          }}
          className="min-h-0 flex-1"
        />
      </div>

      {editing ? (
        <div role="dialog" aria-modal="true" aria-label="Edit discovery priority" className="fixed inset-0 z-50 grid place-items-center bg-[var(--surface-scrim)] p-6">
          <Panel panelId="edit-discovery" title="Edit before approving" meta={editing.title} className="w-full max-w-md">
            <PrioritySlider
              value={draftPriority}
              suggested={editing.suggested_priority}
              onCommit={setDraftPriority}
            />
            <p className="mt-1 text-hud-micro uppercase tracking-[0.06em] text-muted">
              Payload sent on approve: <span className="font-machine normal-case">{`{ "priority": ${draftPriority} }`}</span>
            </p>
            <div className="mt-2 flex items-center justify-end gap-1">
              <Button size="sm" onClick={() => setEditing(null)}>
                Cancel <kbd className="ml-1 font-machine text-hud-micro">Esc</kbd>
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const target = editing;
                  setEditing(null);
                  void approve
                    .mutateAsync({ id: target.task_id, priority: draftPriority })
                    .catch((err: unknown) => setError(errorMessage(err)));
                }}
              >
                Approve at P{draftPriority}
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
    </PageShell>
  );
}
