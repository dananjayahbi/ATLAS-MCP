"""`TaskEventDTO` / SSE envelope (Doc 01 §7.5, §7.9)."""

from __future__ import annotations

from api.v1.serializers.computed import iso
from core.models import TaskEvent


def serialize_event(event: TaskEvent) -> dict:
    return {
        "id": event.id,
        "seq": event.seq,
        "type": event.type,
        "level": event.level,
        "project_slug": event.project.slug,
        "task_id": str(event.task_id) if event.task_id else None,
        "message": event.message,
        "payload": event.payload,
        "ts": iso(event.created_at),
    }
