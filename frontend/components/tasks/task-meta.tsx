"use client";

import { cn } from "@/lib/format/cn";
import { formatDuration, formatRelativeTime, formatCountdown } from "@/lib/format/duration";
import { middlePath, shortTaskId } from "@/lib/format/path";
import { LEASE_CLASS, leaseTone, STATUS_META } from "@/lib/format/tone";
import type { TaskDetailDTO } from "@/lib/types/api";
import { Badge } from "@/components/ui/badge";
import { MachineText } from "@/components/ui/machine-text";

/** Doc 06 §7.2 row 1 + the meta rail under the title. */

export type TaskMetaProps = {
  task: TaskDetailDTO;
  className?: string;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-hud-micro uppercase tracking-[0.08em] text-disabled">{label}</span>
      <span className="min-w-0 truncate font-machine text-machine-sm text-secondary">{children}</span>
    </div>
  );
}

export function TaskMeta({ task, className }: TaskMetaProps) {
  return (
    <dl className={cn("grid shrink-0 grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3 lg:grid-cols-4", className)}>
      <Field label="Task">
        <span className="text-machine">{shortTaskId(task.id)}</span>
      </Field>
      <Field label="Project">
        <span className="text-flow">{task.project_slug}</span>
      </Field>
      <Field label="Agent">{task.assigned_agent_id ?? "—"}</Field>
      <Field label="Status">
        <span style={{ color: STATUS_META[task.status].cssVar }}>{STATUS_META[task.status].label}</span>
      </Field>
      <Field label="Age">{formatDuration(task.age_hours * 3600)}</Field>
      <Field label="Attempts">{task.attempt_count}</Field>
      <Field label="Dependency weight">{task.dependency_weight}</Field>
      <Field label="Lease">
        <span className={LEASE_CLASS[leaseTone(task.lease_seconds_remaining)]}>
          {task.lease_seconds_remaining === null ? "—" : formatCountdown(task.lease_seconds_remaining)}
        </span>
      </Field>
      <Field label="Created">
        <time dateTime={task.created_at} title={task.created_at}>
          {formatRelativeTime(task.created_at)}
        </time>
      </Field>
      <Field label="Updated">
        <time dateTime={task.updated_at} title={task.updated_at}>
          {formatRelativeTime(task.updated_at)}
        </time>
      </Field>
      <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
        <span className="text-hud-micro uppercase tracking-[0.08em] text-disabled">Blocked by</span>
        {task.blocked_by.length === 0 ? (
          <span className="font-machine text-machine-sm text-secondary">—</span>
        ) : (
          <span className="flex min-w-0 flex-wrap gap-1">
            {task.blocked_by.map((id) => (
              <Badge key={id} tone="review">
                {shortTaskId(id)}
              </Badge>
            ))}
          </span>
        )}
      </div>
      {task.discovered_during_task_id ? (
        <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
          <span className="text-hud-micro uppercase tracking-[0.08em] text-disabled">Discovered during</span>
          <MachineText truncate="middle" className="text-machine-sm">
            {shortTaskId(task.discovered_during_task_id)}
          </MachineText>
        </div>
      ) : null}
      <div className="col-span-2 flex min-w-0 flex-col gap-0.5 sm:col-span-1">
        <span className="text-hud-micro uppercase tracking-[0.08em] text-disabled">Evidence root</span>
        <MachineText truncate="middle" copyable dim className="text-machine-sm">
          {middlePath(task.assets[0]?.absolute_path ?? "—", 30)}
        </MachineText>
      </div>
    </dl>
  );
}
