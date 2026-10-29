"use client";

import { useState } from "react";
import { useClaimLimitRequests, useResolveClaimLimitRequest } from "@/lib/api/queries";
import { errorMessage } from "@/lib/api/errors";
import { toast } from "@/hooks/use-toast";
import type { ClaimLimitRequestDTO } from "@/lib/types/api";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";

function RequestRow({ request }: { request: ClaimLimitRequestDTO }) {
  const resolve = useResolveClaimLimitRequest();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (approve: boolean) => {
    setError(null);
    try {
      await resolve.mutateAsync({ id: request.id, body: approve ? { approve: true } : { approve: false, note } });
      toast({ level: "info", title: approve ? "Claim limit request approved" : "Claim limit request dismissed" });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-chip border border-grid bg-inset p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-machine text-hud-micro text-primary">{request.requested_by_agent}</span>
        <span className="font-machine text-hud-micro tabular-nums text-secondary">{request.current_limit} → {request.requested_limit}</span>
        <span className="min-w-0 flex-1 truncate text-hud-micro text-muted" title={request.reason}>{request.reason}</span>
        <Button variant="primary" onClick={() => void submit(true)} loading={resolve.isPending && resolve.variables?.body.approve} disabled={resolve.isPending}>Approve</Button>
        <Button variant="ghost" onClick={() => void submit(false)} loading={resolve.isPending && !resolve.variables?.body.approve} disabled={resolve.isPending}>Dismiss</Button>
      </div>
      <TextField label={`Dismissal note for ${request.requested_by_agent} (optional)`} value={note} onChange={(event) => setNote(event.target.value)} disabled={resolve.isPending} />
      {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}
    </li>
  );
}

export function ClaimLimitRequests({ slug }: { slug: string }) {
  const requests = useClaimLimitRequests(slug);
  const items = requests.data?.items ?? [];
  if (items.length === 0) {
    return requests.isError ? <AlertBanner severity="warning">{errorMessage(requests.error)}</AlertBanner> : null;
  }

  return (
    <section aria-label="Pending claim limit requests" className="flex min-w-0 flex-col gap-1.5 rounded-hud border border-grid bg-panel p-2">
      <h2 className="text-hud-micro uppercase tracking-[0.08em] text-secondary">Claim limit requests</h2>
      {requests.isError ? <AlertBanner severity="warning">{errorMessage(requests.error)}</AlertBanner> : null}
      <ul className="flex flex-col gap-1.5">
        {items.map((request) => <RequestRow key={request.id} request={request} />)}
      </ul>
    </section>
  );
}
