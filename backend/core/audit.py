"""Append-only JSONL audit log per project (Doc 01 §6.8, Doc 02 §11)."""

from __future__ import annotations

import json
import logging
from typing import Any

from core.enums import AuditEvent
from core.ids import iso_z, utcnow
from core.storage import router

logger = logging.getLogger("atlas.audit")


def _record_path(project_uuid):
    return router.audit_log_path(project_uuid)


def audit(
    *,
    project,
    event: str,
    task_id=None,
    actor: str = "system",
    detail: dict[str, Any] | None = None,
) -> None:
    """Append one audit record.

    Audit writes are best-effort: a full disk must not fail the business
    transaction that already committed, so failures are logged, not raised.
    """
    if event not in {e.value for e in AuditEvent}:
        raise ValueError(f"unknown audit event: {event}")

    payload = {
        "ts": iso_z(utcnow()),
        "project_slug": project.slug,
        "event": event,
        "task_id": str(task_id) if task_id else None,
        "actor": actor,
        "detail": detail or {},
    }
    line = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    try:
        path = _record_path(project.pk)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(line + "\n")
            fh.flush()
    except OSError:
        logger.exception("audit append failed for project %s", project.slug)


def read_audit(project, *, limit: int = 200) -> list[dict[str, Any]]:
    """Tail the audit log (operator tooling / tests)."""
    path = _record_path(project.pk)
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:  # pragma: no cover - truncated tail
            continue
    return out
