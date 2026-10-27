// Doc 01 §6.2 — enums are frozen; wire value == DB value, no translation.
export type TaskStatus =
  | "PENDING_APPROVAL"
  | "PENDING"
  | "IN_PROGRESS"
  | "IN_REVIEW"
  | "COMPLETED"
  | "REJECTED";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type AssetKind =
  | "INPUT_SCREENSHOT"
  | "ANNOTATED_CANVAS"
  | "USER_CONTEXT"
  | "OUTPUT_PATCH"
  | "VERIFICATION_IMAGE"
  | "TEST_LOG";

export type AssetSource = "HUMAN" | "AGENT" | "SYSTEM";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "PATH_OUT_OF_SCOPE"
  | "AUTH_MISSING"
  | "AUTH_INVALID"
  | "PROJECT_NOT_FOUND"
  | "TASK_NOT_FOUND"
  | "ASSET_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "TASK_ALREADY_LEASED"
  | "STALE_LEASE"
  | "DEPENDENCY_CYCLE"
  | "DEPENDENCY_UNSATISFIABLE"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "STORAGE_WRITE_FAILED"
  | "BACKEND_UNAVAILABLE";

export type EventType =
  | "task.created"
  | "task.updated"
  | "task.status_changed"
  | "task.priority_changed"
  | "task.dod_updated"
  | "task.log"
  | "task.lease_expired"
  | "task.submitted"
  | "review.approved"
  | "review.rejected"
  | "discovery.created"
  | "discovery.approved"
  | "discovery.rejected"
  | "agent.connected"
  | "agent.heartbeat"
  | "system.boot"
  | "system.recovery"
  | "telemetry.tick";

/** Wire contract version — Doc 01 §1.2 */
export const CONTRACT_VERSION = "1.0.0";

export type ChecklistItemDTO = {
  id: number;
  label: string;
  completed: boolean;
  completed_at: string | null;
};

export type AssetDTO = {
  id: string;
  kind: AssetKind;
  filename: string;
  mime_type: string;
  byte_size: number;
  source: AssetSource;
  absolute_path: string;
  url: string;
  created_at: string;
};

/** Canvas tool enum — Doc 07 §4 */
export type CanvasTool = "pen" | "rect" | "arrow" | "text" | "blur" | "eraser";

export type Stroke = {
  id: string;
  tool: CanvasTool;
  color: string;
  width: number;
  points: { x: number; y: number }[];
  text?: string;
};
