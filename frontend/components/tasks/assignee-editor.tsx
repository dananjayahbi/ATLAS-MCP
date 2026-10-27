"use client";

import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { useSetAssignee } from "@/lib/api/queries";
import { toast } from "@/hooks/use-toast";
import type { TaskDetailDTO } from "@/lib/types/api";
import { ASSIGNMENT_HINT } from "@/components/tasks/status-menu";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";

/**
 * Manual assignee override.
 *
 * Answers the question the agent filter provokes: *how does a task get an
 * agent?* Two ways — an agent claims it (the normal path, which grants a
 * lease), or an operator pins a name here. Pinning is a hint only, so it is
 * refused while a lease is live.
 */

export type AssigneeEditorProps = {
  task: TaskDetailDTO;
  /** Agents seen elsewhere in the project, offered as suggestions. */
  knownAgents?: readonly string[];
  className?: string;
};

export function AssigneeEditor({ task, knownAgents = [], className }: AssigneeEditorProps) {
  const setAssignee = useSetAssignee();
  const [value, setValue] = useState(task.assigned_agent_id ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(task.assigned_agent_id ?? "");
    setError(null);
  }, [task.assigned_agent_id]);

  const leased = task.lease_seconds_remaining !== null;
  const dirty = (task.assigned_agent_id ?? "") !== value.trim();
  const listId = `agents-${task.id}`;

  const commit = async (next: string | null) => {
    try {
      await setAssignee.mutateAsync({ id: task.id, agentIdentifier: next });
      toast({ level: "info", title: next ? `Assigned to ${next}` : "Unassigned" });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className={className}>
      <div className="flex items-end gap-1">
        <TextField
          label="Assignee"
          value={value}
          list={listId}
          disabled={leased || setAssignee.isPending}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Agent-Claude"
          fieldClassName="min-w-0 flex-1"
          hint={leased ? "A live lease owns this task — release it before reassigning." : undefined}
        />
        <datalist id={listId}>
          {knownAgents.map((agent) => (
            <option key={agent} value={agent} />
          ))}
        </datalist>
        <Button
          size="sm"
          onClick={() => void commit(value.trim() || null)}
          disabled={!dirty || leased}
          loading={setAssignee.isPending}
          className="mb-5"
        >
          Assign
        </Button>
        {task.assigned_agent_id ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void commit(null)}
            disabled={leased || setAssignee.isPending}
            className="mb-5"
          >
            Clear
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-hud-micro text-critical-hot">
          {error}
        </p>
      ) : (
        <p className="text-hud-micro leading-snug text-disabled">{ASSIGNMENT_HINT}</p>
      )}
    </div>
  );
}
