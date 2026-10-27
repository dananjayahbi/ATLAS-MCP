"""Lease acquisition, renewal and release (Doc 01 §11, Doc 03 §4).

Why this is not `select_for_update()`
-------------------------------------
SQLite has no `SELECT ... FOR UPDATE`; Django silently ignores it. The frozen
algorithm is a **conditional single-statement UPDATE** inside an immediate
transaction. The number of affected rows is the linearisation point:

    updated == 1  ->  this caller won
    updated == 0  ->  someone else won; retry or report NO_ELIGIBLE_TASK

Correctness rests on three facts:
1. `transaction_mode=IMMEDIATE` takes the write lock at BEGIN, so two claimers
   cannot interleave their read-then-write windows.
2. The `WHERE status='PENDING'` predicate is evaluated by SQLite at write time.
3. `UPDATE ... RETURNING` lets us read the pre-image while writing atomically.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction
from django.db.models import F

from core.audit import audit
from core.enums import AuditEvent, EventType, TaskStatus
from core.errors import (
    InvalidTransition,
    StaleLease,
    TaskAlreadyLeased,
    TaskNotFound,
)
from core.events import emit
from core.ids import lease_id as new_lease_id
from core.ids import utcnow
from core.models import Asset, ChecklistItem, Project, Task

logger = logging.getLogger("atlas.leases")

LEASE_TTL_SECONDS = int(getattr(settings, "ATLAS_LEASE_TTL_SECONDS", 900))
RECLAIM_GRACE_SECONDS = int(getattr(settings, "ATLAS_RECLAIM_GRACE_SECONDS", 60))

#: A claim that loses the race retries this many times before giving up.
CLAIM_ATTEMPTS = 3


@dataclass(frozen=True)
class ClaimResult:
    task: Task
    lease_id: str
    expires_at: object


@dataclass(frozen=True)
class NoEligibleTask:
    reason: str = "NO_ELIGIBLE_TASK"


def _eligible_candidates(project_id, min_priority: int):
    """Ordered candidate ids that pass the claim filter (Doc 01 §8 T5).

    Blocked tasks are skipped **silently** — a queue scan is not a user action.
    """
    from django.db.models import Exists, OuterRef

    through = Task.blocked_by.through
    unsatisfied = through.objects.filter(from_task_id=OuterRef("pk")).exclude(
        to_task__status=TaskStatus.COMPLETED
    )
    return (
        Task.objects.filter(
            project_id=project_id,
            status=TaskStatus.PENDING,
            priority__gte=min_priority,
        )
        .annotate(_blocked=Exists(unsatisfied))
        .filter(_blocked=False)
        .order_by("-priority", "created_at")
        .values_list("pk", flat=True)[:25]
    )


def _try_claim(task_id, agent_identifier: str) -> ClaimResult | None:
    """Attempt the atomic claim. Returns None when the candidate was taken.

    The conditional single-statement UPDATE *is* the linearisation point: the
    `WHERE status='PENDING'` predicate is evaluated by SQLite at write time and
    the affected-row count tells us whether we won. Using the ORM (rather than
    raw SQL) keeps UUID/datetime coercion on the backend's own adapters — on
    SQLite a UUID is stored as dashless `char(32)`, so a raw `str(uuid)` bind
    would silently match zero rows.
    """
    now = utcnow()
    expires = now + timedelta(seconds=LEASE_TTL_SECONDS)
    lease = new_lease_id()

    updated = Task.objects.filter(pk=task_id, status=TaskStatus.PENDING).update(
        status=TaskStatus.IN_PROGRESS,
        lease_id=lease,
        lease_expires_at=expires,
        assigned_agent_id=agent_identifier,
        claimed_at=now,
        last_heartbeat_at=now,
        attempt_count=F("attempt_count") + 1,
        updated_at=now,
    )
    if updated != 1:
        return None

    task = Task.objects.select_related("project").get(pk=task_id)
    return ClaimResult(task=task, lease_id=lease, expires_at=expires)


def claim_next_task(
    *,
    project_slug: str,
    agent_identifier: str,
    min_priority: int = 0,
) -> ClaimResult | NoEligibleTask:
    """Claim the highest-priority eligible task (Doc 01 §8 T5)."""
    try:
        project = Project.objects.get(slug=project_slug)
    except Project.DoesNotExist:
        from core.errors import ProjectNotFound

        raise ProjectNotFound(
            f"No project with slug '{project_slug}'.",
            detail={"slug": project_slug},
        ) from None

    if project.archived_at is not None:
        return NoEligibleTask()

    for _ in range(CLAIM_ATTEMPTS):
        candidates = list(_eligible_candidates(project.pk, min_priority))
        if not candidates:
            return NoEligibleTask()

        for candidate_id in candidates:
            try:
                with transaction.atomic():
                    result = _try_claim(candidate_id, agent_identifier)
                    if result is None:
                        continue
                    task = result.task
                    audit(
                        project=project,
                        event=AuditEvent.LEASE_GRANTED,
                        task_id=task.pk,
                        actor=agent_identifier,
                        detail={"lease_id": result.lease_id, "ttl": LEASE_TTL_SECONDS},
                    )
                    emit(
                        project=project,
                        task=task,
                        type=EventType.TASK_STATUS_CHANGED,
                        message=f"{TaskStatus.PENDING} -> {TaskStatus.IN_PROGRESS}",
                        payload={"agent_identifier": agent_identifier,
                                 "lease_id": result.lease_id},
                    )
                    return result
            except Exception:
                logger.exception("claim attempt failed for task %s", candidate_id)
                raise

    return NoEligibleTask()


def claim_specific_task(
    *,
    task_id,
    agent_identifier: str,
) -> ClaimResult:
    """T14 — human assigns one known task to an agent (Doc 01 §8).

    Sole emitter of `TASK_ALREADY_LEASED`.
    """
    with transaction.atomic():
        try:
            task = Task.objects.select_related("project").get(pk=task_id)
        except Task.DoesNotExist:
            raise TaskNotFound("Task not found.", detail={"task_id": str(task_id)}) from None

        now = utcnow()
        if task.status == TaskStatus.IN_PROGRESS and task.lease_expires_at and task.lease_expires_at > now:
            raise TaskAlreadyLeased(
                f"Task is leased by {task.assigned_agent_id}.",
                detail={
                    "task_id": str(task.pk),
                    "assigned_agent_id": task.assigned_agent_id,
                    "current_lease_id": task.lease_id,
                },
            )
        if task.status != TaskStatus.PENDING:
            raise InvalidTransition(task.status, "claim_for_agent")

        # T5 excludes archived projects from the claim filter; T14 must agree or
        # archiving would still let a human hand out work in a parked workspace.
        if task.project.archived_at is not None:
            raise InvalidTransition(
                task.status,
                "claim_for_agent",
                "Project is archived; restore it before claiming work.",
            )

        if task.is_blocked():
            raise InvalidTransition(task.status, "claim_for_agent",
                                    "Task is blocked by an incomplete dependency.")

        result = _try_claim(task.pk, agent_identifier)
        if result is None:
            raise InvalidTransition(task.status, "claim_for_agent",
                                    "Task changed state while being claimed.")

        audit(
            project=task.project,
            event=AuditEvent.LEASE_GRANTED,
            task_id=task.pk,
            actor="human",
            detail={"lease_id": result.lease_id, "agent_identifier": agent_identifier},
        )
        emit(
            project=task.project,
            task=task,
            type=EventType.TASK_STATUS_CHANGED,
            message=f"{TaskStatus.PENDING} -> {TaskStatus.IN_PROGRESS}",
            payload={"agent_identifier": agent_identifier, "lease_id": result.lease_id},
        )
        return result


def heartbeat(*, task_id, lease: str) -> tuple[Task, int]:
    """Renew a lease (Doc 01 §8 T6). Returns `(task, seconds_remaining)`."""
    now = utcnow()
    with transaction.atomic():
        try:
            task = Task.objects.select_related("project").get(pk=task_id)
        except Task.DoesNotExist:
            raise TaskNotFound("Task not found.", detail={"task_id": str(task_id)}) from None

        if task.status != TaskStatus.IN_PROGRESS:
            raise InvalidTransition(task.status, "heartbeat")

        # A mismatch is a stale lease — mutate nothing (invariant I4).
        if not task.lease_id or task.lease_id != lease:
            raise StaleLease(
                f"lease_id does not match the live lease for task {task.pk}.",
                detail={"task_id": str(task.pk), "lease_id": lease},
            )

        expiry = task.lease_expires_at
        grace = timedelta(seconds=RECLAIM_GRACE_SECONDS)
        if expiry is not None and expiry + grace < now:
            raise StaleLease(
                "Lease expired beyond the reclaim grace window.",
                detail={"task_id": str(task.pk), "lease_expires_at": expiry.isoformat()},
            )

        new_expiry = now + timedelta(seconds=LEASE_TTL_SECONDS)
        Task.objects.filter(pk=task.pk, lease_id=lease).update(
            lease_expires_at=new_expiry,
            last_heartbeat_at=now,
            updated_at=now,
        )
        audit(
            project=task.project,
            event=AuditEvent.LEASE_RENEWED,
            task_id=task.pk,
            actor=task.assigned_agent_id or "agent",
            detail={"lease_id": lease},
        )
        return task, LEASE_TTL_SECONDS


def release(*, task_id, actor: str = "human", reason: str = "force_release") -> Task:
    """T11 — force-release an in-progress task back to PENDING."""
    now = utcnow()
    with transaction.atomic():
        try:
            task = Task.objects.select_related("project").get(pk=task_id)
        except Task.DoesNotExist:
            raise TaskNotFound("Task not found.", detail={"task_id": str(task_id)}) from None

        if task.status != TaskStatus.IN_PROGRESS:
            raise InvalidTransition(task.status, reason)

        previous_lease = task.lease_id
        Task.objects.filter(pk=task.pk).update(
            status=TaskStatus.PENDING,
            lease_id=None,
            lease_expires_at=None,
            assigned_agent_id=None,
            updated_at=now,
        )
        task.refresh_from_db()
        audit(
            project=task.project,
            event=AuditEvent.LEASE_RECLAIMED,
            task_id=task.pk,
            actor=actor,
            detail={"previous_lease": previous_lease, "reason": reason},
        )
        emit(
            project=task.project,
            task=task,
            type=EventType.TASK_STATUS_CHANGED,
            message=f"{TaskStatus.IN_PROGRESS} -> {TaskStatus.PENDING} ({reason})",
            payload={"actor": actor},
        )
        return task


def reclaim_expired(*, older_than_seconds: int = 0) -> list[Task]:
    """T10 — system reclaim of expired leases (Doc 03 §5).

    Returns the tasks reclaimed. Safe to call from a sweeper thread and from
    the boot janitor concurrently: the `UPDATE ... WHERE lease_expires_at < ?`
    predicate makes it idempotent.
    """
    from django.db.models import Q

    now = utcnow()
    cutoff = now - timedelta(seconds=older_than_seconds)
    reclaimed: list[Task] = []

    candidates = list(
        Task.objects.filter(
            status=TaskStatus.IN_PROGRESS,
            lease_expires_at__lt=cutoff,
        )
        .select_related("project")
        .order_by("lease_expires_at")[:200]
    )
    for task in candidates:
        previous_lease = task.lease_id
        with transaction.atomic():
            updated = Task.objects.filter(
                pk=task.pk,
                status=TaskStatus.IN_PROGRESS,
                lease_expires_at__lt=cutoff,
            ).update(
                status=TaskStatus.PENDING,
                lease_id=None,
                lease_expires_at=None,
                assigned_agent_id=None,
                updated_at=now,
            )
            if updated != 1:
                continue

            task.refresh_from_db()
            reclaimed.append(task)
            emit(
                project=task.project,
                task=task,
                type=EventType.TASK_LEASE_EXPIRED,
                level="WARN",
                message="[SYSTEM CRASH DETECTED] lease expired; task returned to queue",
                payload={"previous_lease": previous_lease},
            )
            audit(
                project=task.project,
                event=AuditEvent.LEASE_RECLAIMED,
                task_id=task.pk,
                actor="system",
                detail={"previous_lease": previous_lease},
            )

    return reclaimed


def clear_lease(task: Task, *, now=None) -> None:
    """Clear lease columns **without** changing status (used by submit/review)."""
    when = now or utcnow()
    Task.objects.filter(pk=task.pk).update(
        lease_id=None,
        lease_expires_at=None,
        last_heartbeat_at=None,
        updated_at=when,
    )


def seconds_remaining(task: Task, *, now=None) -> int:
    if task.lease_expires_at is None:
        return 0
    delta = task.lease_expires_at - (now or utcnow())
    return max(0, int(delta.total_seconds()))


def lease_guard(task: Task, lease: str | None, *, action: str) -> None:
    """Shared precondition for submit/progress/DoD mutations."""
    if task.status != TaskStatus.IN_PROGRESS:
        raise InvalidTransition(task.status, action)
    if lease and task.lease_id != lease:
        raise StaleLease(
            "lease_id does not match the live lease.",
            detail={"task_id": str(task.pk), "lease_id": lease},
        )


__all__ = [
    "LEASE_TTL_SECONDS",
    "RECLAIM_GRACE_SECONDS",
    "ClaimResult",
    "NoEligibleTask",
    "claim_next_task",
    "claim_specific_task",
    "heartbeat",
    "release",
    "reclaim_expired",
    "clear_lease",
    "seconds_remaining",
    "lease_guard",
]
