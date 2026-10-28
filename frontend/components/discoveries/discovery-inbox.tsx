"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/format/cn";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { useTriageShelf } from "@/hooks/use-triage-shelf";
import { toast } from "@/hooks/use-toast";
import type { DiscoveryDTO } from "@/lib/types/api";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscoveryCard } from "./discovery-card";
import { TriageActions } from "./triage-actions";

/**
 * Doc 06 §9 — triage inbox: `j/k/a/r` navigation plus the 5 s dispatch delay. The
 * row disappears immediately, but no request exists until the timer elapses.
 */

export type DiscoveryInboxProps = {
  discoveries: readonly DiscoveryDTO[];
  loading?: boolean;
  onApprove: (discovery: DiscoveryDTO, priority: number) => Promise<unknown>;
  onReject: (discovery: DiscoveryDTO) => Promise<unknown>;
  onRestore: (taskId: string) => Promise<unknown>;
  onEdit?: (discovery: DiscoveryDTO) => void;
  className?: string;
};

export function DiscoveryInbox({
  discoveries,
  loading = false,
  onApprove,
  onReject,
  onRestore,
  onEdit,
  className,
}: DiscoveryInboxProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { shelf, removed, now, schedule, undo } = useTriageShelf({
    onApprove,
    onReject,
    onRestore,
    onError: setError,
    onDispatched: (discovery, kind) =>
      toast({
        level: "info",
        title: kind === "approve" ? "Discovery approved" : "Discovery dismissed",
        body:
          kind === "approve"
            ? `${discovery.title} — the task is now in the queue.`
            : `${discovery.title} — press U to undo.`,
      }),
  });

  const visible = useMemo(
    () => discoveries.filter((discovery) => !removed.has(discovery.task_id)),
    [discoveries, removed],
  );

  useEffect(() => {
    if (activeIndex > visible.length - 1) setActiveIndex(Math.max(0, visible.length - 1));
  }, [activeIndex, visible.length]);

  const active = visible[activeIndex] ?? null;

  useKeyboardNav({
    ids: visible.map((discovery) => discovery.task_id),
    activeIndex,
    setActiveIndex,
    onOpen: (id) => setExpandedId((current) => (current === id ? null : id)),
    onApprove: () => active && schedule(active, "approve", active.priority),
    onReject: () => active && schedule(active, "reject", active.priority),
    extra: [
      { key: "e", scopes: ["global"], run: () => active && onEdit?.(active) },
      { key: "Delete", scopes: ["global"], run: () => active && schedule(active, "reject", active.priority) },
      { key: "Backspace", scopes: ["global"], run: () => active && schedule(active, "reject", active.priority) },
      {
        key: "u",
        scopes: ["global"],
        run: () => {
          const last = shelf[shelf.length - 1];
          if (last) undo(last.taskId);
        },
      },
      {
        key: " ",
        scopes: ["global"],
        run: () => active && setExpandedId((current) => (current === active.task_id ? null : active.task_id)),
      },
    ],
  });

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <TriageActions entries={shelf} now={now} onUndo={undo} awaiting={visible.length} />

      <div aria-live="polite" className="sr-only">
        {visible.length === 0 ? "Inbox clear" : `${visible.length} discoveries awaiting triage`}
      </div>

      {error ? (
        <p role="alert" className="shrink-0 text-hud-body text-critical-hot">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 rounded-chip border border-grid px-1 font-machine text-hud-micro text-muted hover:text-primary"
          >
            dismiss
          </button>
        </p>
      ) : null}

      <div role="list" aria-label="Discovery inbox" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {loading && visible.length === 0 ? <Skeleton lines={6} /> : null}
        {!loading && visible.length === 0 ? (
          <EmptyState
            title="Inbox clear — agents have not proposed anything"
            hint="New discoveries arrive over the project event stream."
          />
        ) : null}
        {visible.map((discovery, index) => (
          <div role="listitem" key={discovery.task_id}>
            <DiscoveryCard
              discovery={discovery}
              active={index === activeIndex}
              expanded={expandedId === discovery.task_id}
              onFocus={() => setActiveIndex(index)}
              onApprove={() => schedule(discovery, "approve", discovery.priority)}
              onDismiss={() => schedule(discovery, "reject", discovery.priority)}
              onEdit={() => onEdit?.(discovery)}
              onExpand={() => setExpandedId((current) => (current === discovery.task_id ? null : discovery.task_id))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
