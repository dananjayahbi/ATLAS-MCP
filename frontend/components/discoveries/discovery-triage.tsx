"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import {
  useApproveDiscovery,
  useDiscoveries,
  useRejectDiscovery,
  useRestoreDiscovery,
} from "@/lib/api/queries";
import type { DiscoveryDTO } from "@/lib/types/api";
import { PageShell } from "@/components/hud/hud-frame";
import { DiscoveryInbox } from "@/components/discoveries/discovery-inbox";
import { EditDiscoveryDialog } from "@/components/discoveries/edit-discovery-dialog";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";

/** Doc 06 §9 — `/discoveries` triage inbox. */

export function DiscoveryTriage() {
  const query = useDiscoveries();
  const approve = useApproveDiscovery();
  const reject = useRejectDiscovery();
  const restore = useRestoreDiscovery();
  const [editing, setEditing] = useState<DiscoveryDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = query.data?.items ?? [];

  // The dialog reads the live row from the cache, so an edit made in the dialog
  // (or a refetch that lands while it is open) never shows stale text.
  const editingLive = editing
    ? (items.find((row) => row.task_id === editing.task_id) ?? editing)
    : null;

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
          onEdit={setEditing}
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
          onRestore={async (taskId) => {
            try {
              await restore.mutateAsync({ id: taskId });
            } catch (err) {
              setError(errorMessage(err));
              throw err;
            }
          }}
          className="min-h-0 flex-1"
        />
      </div>

      <EditDiscoveryDialog
        open={editingLive !== null}
        discovery={editingLive}
        onClose={() => setEditing(null)}
        onSaved={() => void query.refetch()}
        onAssetsChanged={() => void query.refetch()}
        onApprove={async (discovery, priority) => {
          await approve.mutateAsync({ id: discovery.task_id, priority });
          await query.refetch();
        }}
      />
    </PageShell>
  );
}
