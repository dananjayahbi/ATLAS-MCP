"use client";

import Link from "next/link";
import { cn } from "@/lib/format/cn";
import { formatRelativeTime } from "@/lib/format/duration";
import { formatPriority } from "@/lib/format/priority";
import { shortTaskId } from "@/lib/format/path";
import type { DiscoveryDTO } from "@/lib/types/api";
import { Badge, PriorityChip, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/** Doc 06 §9.2 — one discovery card. Every field comes from `DiscoveryDTO`. */

export type DiscoveryCardProps = {
  discovery: DiscoveryDTO;
  active?: boolean;
  expanded?: boolean;
  pendingEditPriority?: number | null;
  onApprove?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  onExpand?: () => void;
  onFocus?: () => void;
  busy?: boolean;
  className?: string;
};

const MAX_THUMBS = 3;

export function DiscoveryCard({
  discovery,
  active,
  expanded,
  pendingEditPriority = null,
  onApprove,
  onEdit,
  onDismiss,
  onExpand,
  onFocus,
  busy = false,
  className,
}: DiscoveryCardProps) {
  const thumbs = discovery.assets.filter((asset) => asset.mime_type.startsWith("image/"));
  const shown = thumbs.slice(0, MAX_THUMBS);
  const overflow = thumbs.length - shown.length;
  const priority = pendingEditPriority ?? discovery.priority;

  return (
    <article
      aria-current={active ? "true" : undefined}
      onFocusCapture={onFocus}
      className={cn(
        "relative flex min-w-0 flex-col gap-1.5 rounded-hud border bg-panel/80 p-2 transition-colors duration-100",
        active ? "border-flow/60 bg-flow-tint/20" : "border-grid hover:border-grid-strong",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span aria-hidden className="text-review-hot">
          ⚡
        </span>
        <span className="font-machine text-hud-micro uppercase tracking-[0.06em] text-flow">
          {discovery.discovered_by_agent}
        </span>
        <span aria-hidden className="text-disabled">
          ·
        </span>
        <Link
          href={`/projects/${discovery.project_slug}`}
          className="rounded-chip border border-grid px-1 font-machine text-hud-micro uppercase text-secondary hover:border-grid-strong hover:text-primary"
        >
          {discovery.project_slug}
        </Link>
        <time dateTime={discovery.created_at} className="font-machine text-hud-micro tabular-nums text-muted">
          {formatRelativeTime(discovery.created_at)}
        </time>
        <span className="min-w-0 flex-1" />
        <PriorityChip priority={priority} />
        <StatusBadge status={discovery.status} />
      </div>

      <h3 className="min-w-0 text-hud-title font-semibold text-primary" title={discovery.title}>
        {discovery.title}
      </h3>

      <p className={cn("min-w-0 text-hud-body text-secondary", expanded ? "" : "line-clamp-3")}>{discovery.description}</p>

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-hud-micro text-muted">
        {discovery.discovered_during_task_id ? (
          <Link
            href={`/projects/${discovery.project_slug}/tasks/${discovery.discovered_during_task_id}`}
            className="font-machine text-secondary hover:text-flow hover:underline"
          >
            ↳ discovered during {shortTaskId(discovery.discovered_during_task_id)}
          </Link>
        ) : null}
        {discovery.discovery_reason ? (
          <span className="min-w-0 truncate italic text-muted" title={discovery.discovery_reason}>
            {discovery.discovery_reason}
          </span>
        ) : null}
        {priority !== discovery.suggested_priority ? (
          <Badge tone="review">
            suggested {formatPriority(discovery.suggested_priority)} → {formatPriority(priority)}
          </Badge>
        ) : null}
      </div>

      {shown.length > 0 ? (
        <ul className="flex shrink-0 items-center gap-1" aria-label="Evidence thumbnails">
          {shown.map((asset) => (
            <li key={asset.id}>
              <a
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                title={`${asset.filename} · ${(asset.byte_size / 1024).toFixed(0)} kB`}
                className="block overflow-hidden rounded-chip border border-grid hover:border-flow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
              >
                {/* Asset URLs are same-origin via the rewrite; next/image is intentionally unused (no optimizer). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.url} alt={asset.filename} width={56} height={36} className="h-9 w-14 object-cover" />
              </a>
            </li>
          ))}
          {overflow > 0 ? (
            <li className="font-machine text-hud-micro text-muted">+{overflow}</li>
          ) : null}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        <Button variant="primary" size="sm" onClick={onApprove} disabled={busy} loading={busy}>
          Approve <Kbd size="xs">A</Kbd>
        </Button>
        <Button size="sm" onClick={onEdit} disabled={busy}>
          Edit <Kbd size="xs">E</Kbd>
        </Button>
        <Button size="sm" variant="danger" onClick={onDismiss} disabled={busy}>
          Dismiss <Kbd size="xs">Del</Kbd>
        </Button>
        <Button size="sm" variant="ghost" onClick={onExpand} aria-expanded={expanded}>
          {expanded ? "Less" : "More"} <Kbd size="xs">Space</Kbd>
        </Button>
      </div>
    </article>
  );
}
