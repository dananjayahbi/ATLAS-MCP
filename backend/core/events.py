"""In-process event bus + durable event persistence (Doc 09 §2).

Two responsibilities, kept separate on purpose:

1. `record(...)` — allocate the per-project `seq`, persist the row, and return
   the frozen `TaskEventDTO`. Called inside the caller's transaction.
2. `publish(...)` — fan out to live SSE subscribers **after** commit via
   `transaction.on_commit`, so a subscriber can never observe a rollback.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
from dataclasses import dataclass
from typing import Any, Iterable

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Max

from core.enums import EventType, LogLevel
from core.ids import event_id, iso_z
from core.models import TaskEvent

logger = logging.getLogger("atlas.events")

#: Per-subscriber backlog. A slow client is dropped rather than blocking writes.
QUEUE_MAXSIZE = 256


@dataclass(frozen=True)
class Envelope:
    id: str
    seq: int
    type: str
    level: str
    project_slug: str
    task_id: str | None
    message: str
    payload: dict[str, Any] | None
    ts: str

    def to_dto(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "seq": self.seq,
            "type": self.type,
            "level": self.level,
            "project_slug": self.project_slug,
            "task_id": self.task_id,
            "message": self.message,
            "payload": self.payload,
            "ts": self.ts,
        }

    def to_sse(self) -> str:
        """Render as an SSE frame (Doc 01 §7.9)."""
        data = json.dumps(self.to_dto(), separators=(",", ":"), ensure_ascii=False)
        return f"id: {self.id}\nevent: {self.type}\ndata: {data}\n\n"


class EventBus:
    """Project-scoped fan-out with a bounded queue per subscriber."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: dict[str, set[queue.Queue]] = {}

    def subscribe(self, project_slug: str) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=QUEUE_MAXSIZE)
        with self._lock:
            self._subscribers.setdefault(project_slug, set()).add(q)
        return q

    def unsubscribe(self, project_slug: str, q: queue.Queue) -> None:
        with self._lock:
            bucket = self._subscribers.get(project_slug)
            if not bucket:
                return
            bucket.discard(q)
            if not bucket:
                self._subscribers.pop(project_slug, None)

    def publish(self, envelope: Envelope) -> None:
        with self._lock:
            bucket = tuple(self._subscribers.get(envelope.project_slug, ()))
        for q in bucket:
            try:
                q.put_nowait(envelope)
            except queue.Full:
                logger.warning(
                    "SSE subscriber backlog full for project %s; dropping frame",
                    envelope.project_slug,
                )

    def subscriber_count(self, project_slug: str) -> int:
        with self._lock:
            return len(self._subscribers.get(project_slug, ()))


bus = EventBus()


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------
def _next_seq(project_id) -> int:
    """Allocate `MAX(seq)+1` under the write lock (Doc 01 §11.3).

    Called from within `transaction.atomic()`; with `transaction_mode=IMMEDIATE`
    the write lock is already held, so two concurrent allocators serialise.
    """
    current = (
        TaskEvent.objects.filter(project_id=project_id).aggregate(m=Max("seq"))["m"] or 0
    )
    return current + 1


def record(
    *,
    project,
    type: str,
    message: str = "",
    task=None,
    level: str = LogLevel.INFO,
    payload: dict[str, Any] | None = None,
) -> Envelope:
    """Persist one event and return its wire envelope.

    Must be called inside an atomic block by the caller so the event commits
    with the state change it describes.
    """
    if payload is not None:
        encoded = json.dumps(payload, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 2048:
            raise ValueError("event payload exceeds the 2 kB ceiling (Doc 01 §6.7)")

    row = TaskEvent.objects.create(
        id=event_id(),
        project=project,
        task=task,
        seq=_next_seq(project.pk),
        type=type,
        level=level,
        message=message,
        payload=payload,
    )
    return Envelope(
        id=row.id,
        seq=row.seq,
        type=row.type,
        level=row.level,
        project_slug=project.slug,
        task_id=str(task.pk) if task is not None else None,
        message=row.message,
        payload=row.payload,
        ts=iso_z(row.created_at) or "",
    )


def publish_after_commit(envelope: Envelope) -> None:
    """Fan out only once the surrounding transaction has committed."""

    def _emit() -> None:
        try:
            bus.publish(envelope)
        except Exception:  # pragma: no cover - never break a committed write
            logger.exception("SSE fan-out failed for event %s", envelope.id)

    transaction.on_commit(_emit)


def emit(**kwargs) -> Envelope:
    """`record` + `publish_after_commit` in one call."""
    envelope = record(**kwargs)
    publish_after_commit(envelope)
    return envelope


def replay(project_id, *, after_seq: int = 0, limit: int = 500) -> list[Envelope]:
    """Replay persisted events with `seq > after_seq` (Doc 09 §7)."""
    rows = (
        TaskEvent.objects.filter(project_id=project_id, seq__gt=after_seq)
        .select_related("project")
        .order_by("seq")[:limit]
    )
    return [
        Envelope(
            id=r.id,
            seq=r.seq,
            type=r.type,
            level=r.level,
            project_slug=r.project.slug,
            task_id=str(r.task_id) if r.task_id else None,
            message=r.message,
            payload=r.payload,
            ts=iso_z(r.created_at) or "",
        )
        for r in rows
    ]


def last_seq(project_id) -> int:
    return (
        TaskEvent.objects.filter(project_id=project_id).aggregate(m=Max("seq"))["m"] or 0
    )


def reset_frame(project_slug: str) -> Envelope:
    """Transport-only frame emitted on stream (re)connect after a boot change."""
    return Envelope(
        id=event_id(),
        seq=last_seq_by_slug(project_slug),
        type="stream.reset",
        level=LogLevel.INFO,
        project_slug=project_slug,
        task_id=None,
        message="stream reset; refetch authoritative state",
        payload={"boot_id": getattr(settings, "ATLAS_BOOT_ID", "unknown")},
        ts=iso_z(None) or "",
    )


def last_seq_by_slug(project_slug: str) -> int:
    from core.models import Project

    project = Project.objects.filter(slug=project_slug).only("id").first()
    if project is None:
        return 0
    return last_seq(project.pk)


def prune_events(older_than) -> int:
    """Retention: delete rows older than the cutoff (Doc 01 §6.7)."""
    deleted, _ = TaskEvent.objects.filter(created_at__lt=older_than).delete()
    return deleted


def all_types() -> Iterable[str]:
    return (choice.value for choice in EventType)


__all__ = [
    "Envelope",
    "bus",
    "emit",
    "record",
    "publish_after_commit",
    "replay",
    "last_seq",
    "reset_frame",
    "prune_events",
    "QUEUE_MAXSIZE",
    "connection",
]
