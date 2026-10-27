import type { AssetDTO, ChecklistItemDTO, EventType, LogLevel, TaskStatus } from "./enums";

/** Doc 01 §7.2 */
export type ProjectCounters = {
  pending: number;
  in_progress: number;
  in_review: number;
  completed: number;
  pending_approval: number;
  health_percent: number;
};

export type ProjectDTO = {
  contract_version: string;
  id: string;
  slug: string;
  name: string;
  local_repo_path: string;
  accent_color: string;
  global_rules_md: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  counters: ProjectCounters;
  active_agent_id: string | null;
  last_event_at: string | null;
};

/** Doc 01 §7.3 */
export type TaskSummaryDTO = {
  id: string;
  project_slug: string;
  title: string;
  status: TaskStatus;
  priority: number;
  dod_progress_percent: number;
  is_agent_discovered: boolean;
  is_blocked: boolean;
  parent_task_id: string | null;
  age_hours: number;
  dependency_weight: number;
  assigned_agent_id: string | null;
  lease_seconds_remaining: number | null;
  created_at: string;
  updated_at: string;
};

/** Doc 01 §7.5 / §7.9 — identical shape to the SSE envelope. */
export type TaskEventDTO = {
  id: string;
  seq: number;
  type: EventType | "stream.reset";
  level: LogLevel;
  project_slug: string;
  task_id: string | null;
  message: string;
  payload: Record<string, unknown> | null;
  ts: string;
};

/** Doc 01 §7.4 */
export type TaskDetailDTO = TaskSummaryDTO & {
  description: string;
  definition_of_done: ChecklistItemDTO[];
  blocked_by: string[];
  blocks: string[];
  child_task_ids: string[];
  discovered_during_task_id: string | null;
  discovery_reason: string;
  suggested_priority: number | null;
  review_summary: string;
  review_notes: string;
  attempt_count: number;
  assets: AssetDTO[];
  recent_events: TaskEventDTO[];
};

/** Doc 01 §7.6 */
export type DiscoveryDTO = {
  task_id: string;
  project_slug: string;
  title: string;
  description: string;
  status: TaskStatus;
  suggested_priority: number;
  priority: number;
  discovered_during_task_id: string | null;
  discovered_by_agent: string;
  discovery_reason: string;
  assets: AssetDTO[];
  screenshot_absolute_paths: string[];
  created_at: string;
};

/** Doc 01 §7.7 */
export type PriorityMatrixPointDTO = {
  task_id: string;
  title: string;
  project_slug: string;
  status: TaskStatus;
  priority: number;
  age_hours: number;
  dependency_weight: number;
  is_blocked: boolean;
  is_agent_discovered: boolean;
  dod_progress_percent: number;
};

export type MatrixXAxis = "age_hours" | "dependency_weight";

export type PriorityMatrixResponse = {
  points: PriorityMatrixPointDTO[];
  // `x` reflects `?x=` on the request (Doc 06 §11.7): the alternate X axis is a
  // real response value, not a client-side-only toggle.
  axes: { x: MatrixXAxis; x_alternate: MatrixXAxis; y: "priority"; y_max: number };
};

export type TelemetrySummaryDTO = {
  projects: {
    slug: string;
    health_percent: number;
    active_agent_id: string | null;
    in_progress: number;
  }[];
  tasks_by_status: Record<TaskStatus, number>;
  discoveries_pending: number;
  oldest_pending_age_hours: number;
  leases_expiring_within_5m: number;
  throughput_last_24h: number;
  generated_at: string;
};

/** Doc 01 §7.8 */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    detail: Record<string, unknown> | null;
    request_id: string | null;
  };
};

export type ListResponse<T> = { items: T[]; next_cursor: string | null };
