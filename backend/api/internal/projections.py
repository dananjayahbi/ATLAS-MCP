"""Token projection used by `/internal/v1` responses (Doc 01 §9.6, Doc 08).

This is the *server-side* half of the projection contract: the MCP server also
projects, but enforcing the ceiling here means a non-MCP client cannot blow the
token budget either.
"""

from __future__ import annotations

from datetime import datetime

from core.ids import utcnow
from core.models import Task

DESCRIPTION_LIMIT = 8000
RULES_LIMIT = 1200
MAX_IMAGES = 10
MAX_DOD = 40
HARD_CEILING_BYTES = 16_384


def truncate(text: str, limit: int) -> str:
    if text is None:
        return ""
    if len(text) <= limit:
        return text
    return text[: limit - 14].rstrip() + "…[truncated]"


def project_claimed_task(
    task: Task,
    *,
    rules: str = "",
    now: datetime | None = None,
) -> dict:
    """`ClaimedTaskProjection` (Doc 01 §9.2)."""
    from core.paths import to_absolute_native
    from core.storage import router

    reference = now or utcnow()
    lease_ttl = 900
    heartbeat = 120
    from django.conf import settings

    lease_ttl = int(getattr(settings, "ATLAS_LEASE_TTL_SECONDS", 900))
    heartbeat = int(getattr(settings, "ATLAS_HEARTBEAT_INTERVAL_SECONDS", 120))

    items = list(task.checklist.all().order_by("order_index")[:MAX_DOD])
    assets = [
        a
        for a in task.assets.all()
        if a.kind in {"INPUT_SCREENSHOT", "ANNOTATED_CANVAS", "VERIFICATION_IMAGE"}
    ][:MAX_IMAGES]

    remaining = 0
    if task.lease_expires_at is not None:
        remaining = max(0, int((task.lease_expires_at - reference).total_seconds()))

    payload = {
        "task_id": str(task.pk),
        "title": task.title,
        "description": truncate(task.description, DESCRIPTION_LIMIT),
        "priority": task.priority,
        "status": task.status,
        "local_repo_path": task.project.local_repo_path,
        "project_rules": truncate(rules or task.project.global_rules_md, RULES_LIMIT),
        "lease_id": task.lease_id,
        "lease_ttl_seconds": lease_ttl,
        "heartbeat_interval_seconds": heartbeat,
        "definition_of_done": [
            {"id": i.order_index, "label": i.label, "completed": i.completed} for i in items
        ],
        "attached_images": [to_absolute_native(a.relative_path) for a in assets],
    }
    if remaining:
        payload["lease_seconds_remaining"] = remaining
    return enforce_ceiling(payload, task)


def enforce_ceiling(payload: dict, task: Task) -> dict:
    """Guarantee the 16 kB hard ceiling by trimming the two long fields."""
    import json

    def size(candidate: dict) -> int:
        return len(json.dumps(candidate, ensure_ascii=False).encode("utf-8"))

    if size(payload) <= HARD_CEILING_BYTES:
        return payload

    for field, floor in (("description", 1200), ("project_rules", 200)):
        while size(payload) > HARD_CEILING_BYTES and len(payload[field]) > floor:
            keep = max(floor, int(len(payload[field]) * 0.8))
            payload[field] = payload[field][:keep] + "…[truncated]"

    # Last resort: trim the DoD list, then images.
    while size(payload) > HARD_CEILING_BYTES and payload["definition_of_done"]:
        payload["definition_of_done"].pop()
    while size(payload) > HARD_CEILING_BYTES and payload["attached_images"]:
        payload["attached_images"].pop()

    return payload


def project_task_read(task: Task) -> dict:
    """`get_task_details` projection — same shape as claim, plus review state."""
    payload = project_claimed_task(task)
    payload["review_summary"] = truncate(task.review_summary, 2000)
    payload["review_notes"] = truncate(task.review_notes, 2000)
    payload["attempt_count"] = task.attempt_count
    return enforce_ceiling(payload, task)
