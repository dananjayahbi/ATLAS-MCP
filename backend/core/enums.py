"""Frozen enumerations (Doc 01 §6.2).

Wire value == DB value. There is deliberately **no** translation layer: a REST
response, a SQLite row, and an SSE frame all carry the same literal string.
"""

from __future__ import annotations

from django.db import models


class TaskStatus(models.TextChoices):
    PENDING_APPROVAL = "PENDING_APPROVAL", "Pending approval"
    PENDING = "PENDING", "Pending"
    IN_PROGRESS = "IN_PROGRESS", "In progress"
    IN_REVIEW = "IN_REVIEW", "In review"
    COMPLETED = "COMPLETED", "Completed"
    REJECTED = "REJECTED", "Rejected"


#: Statuses that count toward `project_health_percent` (Doc 01 §6.9).
HEALTH_DENOMINATOR_STATUSES = (
    TaskStatus.COMPLETED,
    TaskStatus.PENDING,
    TaskStatus.IN_PROGRESS,
    TaskStatus.IN_REVIEW,
)

#: Terminal statuses — never returned by the claim filter.
TERMINAL_STATUSES = (TaskStatus.COMPLETED, TaskStatus.REJECTED)


class LogLevel(models.TextChoices):
    DEBUG = "DEBUG", "Debug"
    INFO = "INFO", "Info"
    WARN = "WARN", "Warn"
    ERROR = "ERROR", "Error"


class AssetKind(models.TextChoices):
    INPUT_SCREENSHOT = "INPUT_SCREENSHOT", "Input screenshot"
    ANNOTATED_CANVAS = "ANNOTATED_CANVAS", "Annotated canvas"
    USER_CONTEXT = "USER_CONTEXT", "User context"
    OUTPUT_PATCH = "OUTPUT_PATCH", "Output patch"
    VERIFICATION_IMAGE = "VERIFICATION_IMAGE", "Verification image"
    TEST_LOG = "TEST_LOG", "Test log"


class AssetSource(models.TextChoices):
    HUMAN = "HUMAN", "Human"
    AGENT = "AGENT", "Agent"
    SYSTEM = "SYSTEM", "System"


class EventType(models.TextChoices):
    TASK_CREATED = "task.created", "Task created"
    TASK_UPDATED = "task.updated", "Task updated"
    TASK_STATUS_CHANGED = "task.status_changed", "Task status changed"
    TASK_PRIORITY_CHANGED = "task.priority_changed", "Task priority changed"
    TASK_DOD_UPDATED = "task.dod_updated", "Task DoD updated"
    TASK_LOG = "task.log", "Task log"
    TASK_LEASE_EXPIRED = "task.lease_expired", "Task lease expired"
    TASK_SUBMITTED = "task.submitted", "Task submitted"
    REVIEW_APPROVED = "review.approved", "Review approved"
    REVIEW_REJECTED = "review.rejected", "Review rejected"
    DISCOVERY_CREATED = "discovery.created", "Discovery created"
    DISCOVERY_APPROVED = "discovery.approved", "Discovery approved"
    DISCOVERY_REJECTED = "discovery.rejected", "Discovery rejected"
    AGENT_CONNECTED = "agent.connected", "Agent connected"
    AGENT_HEARTBEAT = "agent.heartbeat", "Agent heartbeat"
    SYSTEM_BOOT = "system.boot", "System boot"
    SYSTEM_RECOVERY = "system.recovery", "System recovery"
    TELEMETRY_TICK = "telemetry.tick", "Telemetry tick"


class AuditEvent(models.TextChoices):
    """Allowed `event` values in `project_audit.log` (Doc 01 §6.8)."""

    PROJECT_CREATED = "PROJECT_CREATED", "Project created"
    PROJECT_ARCHIVED = "PROJECT_ARCHIVED", "Project archived"
    PROJECT_RESTORED = "PROJECT_RESTORED", "Project restored"
    TASK_CREATED = "TASK_CREATED", "Task created"
    TASK_STATUS = "TASK_STATUS", "Task status"
    TASK_PRIORITY = "TASK_PRIORITY", "Task priority"
    DOD_TOGGLE = "DOD_TOGGLE", "DoD toggle"
    LEASE_GRANTED = "LEASE_GRANTED", "Lease granted"
    LEASE_RENEWED = "LEASE_RENEWED", "Lease renewed"
    LEASE_RECLAIMED = "LEASE_RECLAIMED", "Lease reclaimed"
    SUBMITTED = "SUBMITTED", "Submitted"
    REVIEW_APPROVED = "REVIEW_APPROVED", "Review approved"
    REVIEW_REJECTED = "REVIEW_REJECTED", "Review rejected"
    DISCOVERY_PROPOSED = "DISCOVERY_PROPOSED", "Discovery proposed"
    DISCOVERY_APPROVED = "DISCOVERY_APPROVED", "Discovery approved"
    DISCOVERY_REJECTED = "DISCOVERY_REJECTED", "Discovery rejected"
    SUBTASK_SPAWNED = "SUBTASK_SPAWNED", "Subtask spawned"
    SYSTEM_BOOT = "SYSTEM_BOOT", "System boot"
    SYSTEM_CRASH_DETECTED = "SYSTEM_CRASH_DETECTED", "System crash detected"
    FILE_WRITE_FAILED = "FILE_WRITE_FAILED", "File write failed"


class ErrorCode:
    """Frozen error taxonomy (Doc 01 §15). Values are wire strings."""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    PATH_OUT_OF_SCOPE = "PATH_OUT_OF_SCOPE"
    AUTH_MISSING = "AUTH_MISSING"
    AUTH_INVALID = "AUTH_INVALID"
    PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
    TASK_NOT_FOUND = "TASK_NOT_FOUND"
    ASSET_NOT_FOUND = "ASSET_NOT_FOUND"
    INVALID_TRANSITION = "INVALID_TRANSITION"
    TASK_ALREADY_LEASED = "TASK_ALREADY_LEASED"
    STALE_LEASE = "STALE_LEASE"
    DEPENDENCY_CYCLE = "DEPENDENCY_CYCLE"
    DEPENDENCY_UNSATISFIABLE = "DEPENDENCY_UNSATISFIABLE"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    UNSUPPORTED_MEDIA_TYPE = "UNSUPPORTED_MEDIA_TYPE"
    RATE_LIMITED = "RATE_LIMITED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    STORAGE_WRITE_FAILED = "STORAGE_WRITE_FAILED"
    BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE"


#: Doc 01 §7.8 HTTP status map.
HTTP_STATUS_FOR_CODE = {
    ErrorCode.VALIDATION_ERROR: 400,
    ErrorCode.PATH_OUT_OF_SCOPE: 400,
    ErrorCode.AUTH_MISSING: 401,
    ErrorCode.AUTH_INVALID: 401,
    ErrorCode.PROJECT_NOT_FOUND: 404,
    ErrorCode.TASK_NOT_FOUND: 404,
    ErrorCode.ASSET_NOT_FOUND: 404,
    ErrorCode.INVALID_TRANSITION: 409,
    ErrorCode.TASK_ALREADY_LEASED: 409,
    ErrorCode.STALE_LEASE: 409,
    ErrorCode.DEPENDENCY_CYCLE: 409,
    ErrorCode.DEPENDENCY_UNSATISFIABLE: 409,
    ErrorCode.PAYLOAD_TOO_LARGE: 413,
    ErrorCode.UNSUPPORTED_MEDIA_TYPE: 415,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.INTERNAL_ERROR: 500,
    ErrorCode.STORAGE_WRITE_FAILED: 507,
    ErrorCode.BACKEND_UNAVAILABLE: 502,
}
