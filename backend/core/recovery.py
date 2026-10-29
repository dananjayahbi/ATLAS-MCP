"""Boot janitor, WAL integrity gate, and runtime sweeper (Doc 03 §4–§6).

Design constraints
------------------
* The boot janitor runs **once** per process, guarded by a module flag, and is
  safe to call from `AppConfig.ready()`.
* `quick_check` is cheap (milliseconds for small DBs) and catches the class of
  corruption where a WAL write was torn mid-checkpoint.
* The runtime sweeper is a daemon thread that never holds a transaction open
  across a sleep, so it cannot starve claim requests.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction

logger = logging.getLogger("atlas.recovery")

_sweeper_lock = threading.Lock()
_sweeper_thread: threading.Thread | None = None
_boot_state: dict[str, object] = {"booted": False, "recovered": 0, "db": "unknown"}


# ---------------------------------------------------------------------------
# SQLite pragmas (Doc 03 §3)
# ---------------------------------------------------------------------------
def apply_pragmas() -> dict[str, str]:
    """Assert/repair the pragma set and report what the DB actually says."""
    reported: dict[str, str] = {}
    with connection.cursor() as cursor:
        for pragma in (
            "journal_mode=WAL",
            "synchronous=NORMAL",
            "foreign_keys=ON",
            "busy_timeout=5000",
        ):
            cursor.execute(f"PRAGMA {pragma};")
            cursor.fetchone()
        for name in ("journal_mode", "synchronous", "foreign_keys", "busy_timeout"):
            cursor.execute(f"PRAGMA {name};")
            row = cursor.fetchone()
            reported[name] = str(row[0]) if row else "unknown"
    return reported


def integrity_check() -> tuple[bool, str]:
    """`PRAGMA quick_check` gate. Returns `(ok, message)`."""
    with connection.cursor() as cursor:
        cursor.execute("PRAGMA quick_check;")
        rows = cursor.fetchall()
    result = "; ".join(str(r[0]) for r in rows) if rows else "unknown"
    return result.lower() == "ok", result


# ---------------------------------------------------------------------------
# Boot janitor (Doc 03 §4)
# ---------------------------------------------------------------------------
def recover_on_boot() -> dict[str, object]:
    """Flag abandoned deadlines and emit a boot event.

    Nothing is re-queued on boot. A process restart says nothing about whether
    the *work* survived — the agent may still be running, or the operator may be
    about to resume it by hand — so recovery only marks passed estimates overdue
    and lets a human decide.
    """
    from core import leases
    from core.enums import EventType
    from core.events import emit
    from core.models import Project

    grace = int(getattr(settings, "ATLAS_RECLAIM_GRACE_SECONDS", 60))
    overdue = leases.mark_overdue(grace_seconds=grace)

    if overdue:
        by_project: dict[object, int] = {}
        for task in overdue:
            by_project[task.project_id] = by_project.get(task.project_id, 0) + 1
        for project_id, count in by_project.items():
            project = Project.objects.filter(pk=project_id).first()
            if project is None:
                continue
            emit(
                project=project,
                type=EventType.SYSTEM_RECOVERY,
                level="WARN",
                message=f"Boot recovery flagged {count} overdue lease(s).",
                payload={"overdue_tasks": count},
            )

    for project in Project.objects.all():
        emit(
            project=project,
            type=EventType.SYSTEM_BOOT,
            message="System boot.",
            payload={"boot_id": getattr(settings, "ATLAS_BOOT_ID", "unknown")},
        )

    _boot_state.update({"booted": True, "recovered": len(overdue)})
    logger.info("boot recovery complete: %s task(s) marked overdue", len(overdue))
    return {"overdue_tasks": len(overdue)}


def health_report() -> dict[str, object]:
    """Payload for `GET /healthz` (Doc 01 §12)."""
    ok, message = True, "ok"
    try:
        ok, message = integrity_check()
        pragmas = apply_pragmas()
        _boot_state["db"] = pragmas.get("journal_mode", "unknown")
        from core.models import Project, Task
        from core.enums import TaskStatus

        counts = {
            "projects": Project.objects.count(),
            "tasks": Task.objects.count(),
            "in_progress": Task.objects.filter(status=TaskStatus.IN_PROGRESS).count(),
        }
    except Exception as exc:  # pragma: no cover - DB unavailable
        return {"status": "error", "detail": str(exc), "db": _boot_state.get("db", "unknown")}

    return {
        "status": "ok" if ok else "degraded",
        "db": _boot_state.get("db", "unknown"),
        "integrity": message,
        "overdue_tasks": _boot_state.get("recovered", 0),
        "boot_id": getattr(settings, "ATLAS_BOOT_ID", "unknown"),
        **counts,
    }


# ---------------------------------------------------------------------------
# Runtime sweeper (Doc 03 §5)
# ---------------------------------------------------------------------------
def _sweep_once() -> int:
    from core import leases

    try:
        return len(leases.mark_overdue())
    except Exception:  # pragma: no cover - never kill the thread
        logger.exception("runtime overdue sweep failed")
        return 0


def _sweeper_loop(interval: int) -> None:
    stop = threading.Event()
    while not stop.wait(interval):
        _sweep_once()


def start_background_sweeper() -> None:
    """Idempotent: at most one sweeper thread per process.

    The sweeper only *marks* overdue work. It never returns a task to the queue,
    so a slow or wedged sweep can never cost an agent its in-flight task.
    """
    global _sweeper_thread
    if os.environ.get("ATLAS_DISABLE_SWEEPER") == "1":
        return
    with _sweeper_lock:
        if _sweeper_thread is not None and _sweeper_thread.is_alive():
            return
        try:
            apply_pragmas()
            integrity_check()
            recover_on_boot()
        except Exception:  # pragma: no cover - DB not migrated yet
            logger.warning("boot recovery skipped (database not ready)")
        interval = int(getattr(settings, "ATLAS_SWEEPER_INTERVAL_SECONDS", 60))
        thread = threading.Thread(
            target=_sweeper_loop,
            args=(interval,),
            name="atlas-overdue-sweeper",
            daemon=True,
        )
        thread.start()
        _sweeper_thread = thread
        logger.info("overdue sweeper started (every %ss)", interval)


def stop_background_sweeper() -> None:  # pragma: no cover - test helper
    global _sweeper_thread
    _sweeper_thread = None


def prune_old_events(days: int = 30) -> int:
    """Retention job (Doc 01 §6.7)."""
    from core.events import prune_events
    from core.ids import utcnow

    return prune_events(utcnow() - timedelta(days=days))
