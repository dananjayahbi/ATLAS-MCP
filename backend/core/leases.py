"""Lease acquisition, renewal, release and overdue tracking (Doc 01 §11, Doc 03 §4).

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

A lease is a **deadline, not a claim**
--------------------------------------
`lease_expires_at` is the agent's own estimate of how long the work will take.
An agent is not a fortune teller, so missing the estimate must not destroy the
work in progress — a reclaim would throw away a half-finished task and hand it
to the next agent, who would restart from zero.

Instead, passing the estimate only marks the task **overdue**:

* `mark_overdue()` stamps `lease_overdue_at` once and emits
  `task.lease_expired` as a `WARN` line (the operator's cue, not a rollback).
* The task stays `IN_PROGRESS` and stays claimed by its agent, forever.
* `heartbeat()` always renews and clears the overdue flag, so a late agent that
  finishes the job simply reports in and continues.

Only a human can take work away from an agent (`release`, T11).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import transaction
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
from core.ids import iso_z
from core.ids import lease_id as new_lease_id
from core.ids import utcnow
from core.models import Asset, ChecklistItem, Project, Task

logger = logging.getLogger("atlas.leases")

LEASE_TTL_SECONDS = int(getattr(settings, "ATLAS_LEASE_TTL_SECONDS", 900))
#: How long past the estimate before the row is flagged overdue. Kept under the
#: historical name so the frozen-constant gate and existing env files keep
#: working; the semantics are "grace before the overdue badge appears".
RECLAIM_GRACE_SECONDS = int(getattr(settings, "ATLAS_RECLAIM_GRACE_SECONDS", 60))
OVERDUE_GRACE_SECONDS = RECLAIM_GRACE_SECONDS

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


@dataclass(frozen=True)
class ClaimLimitReached:
    """Eligible work exists but the project's concurrent-claim ceiling is full.

    Separate from `NoEligibleTask` on purpose: an agent must not treat "the
    queue is empty" and "you already hold the maximum number of tasks" the same
    way. The second one has an action attached — ask the operator.
    """

    limit: int
    in_progress: int
    reason: str = "CLAIM_LIMIT_REACHED"


def claim_slots_used(project) -> int:
    """Tasks currently held in this project, archived rows excluded."""
    return Task.objects.filter(
        project=project,
        status=TaskStatus.IN_PROGRESS,
        archived_at__isnull=True,
    ).count()


def limit_blocked(project) -> ClaimLimitReached | None:
    """Return the blocking detail when `project.claim_limit` is already spent.

    `claim_limit == 0` means unlimited; that is the operator's opt-out, not an
    accidental zero that silently freezes a project.
    """
    limit = int(getattr(project, "claim_limit", 0) or 0)
    if limit <= 0:
        return None
    used = claim_slots_used(project)
    if used >= limit:
        return ClaimLimitReached(limit=limit, in_progress=used)
    return None


def _eligible_candidates(project_id, min_priority: int):
    """Ordered candidate ids that pass the claim filter (Doc 01 §8 T5).

    Blocked tasks are skipped **silently** — a queue scan is not a user action.
    """
    from core.dependencies import unsatisfied_blocker_qs

    return (
        Task.objects.filter(
            project_id=project_id,
            status=TaskStatus.PENDING,
            priority__gte=min_priority,
        )
        .exclude(blocked_by__in=unsatisfied_blocker_qs())
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
        lease_overdue_at=None,
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
) -> ClaimResult | NoEligibleTask | ClaimLimitReached:
    """Claim the highest-priority eligible task (Doc 01 §8 T5).

    Returns `ClaimLimitReached` when the project's concurrent-claim ceiling is
    already spent; the agent's remedy is `request_claim_limit`, never a retry.
    """
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

    # The ceiling is checked before the queue scan: when the agent is already
    # holding its quota, no candidate can be granted, and reporting the limit
    # (rather than an empty queue) is what lets it ask the operator instead of
    # looping on `NO_ELIGIBLE_TASK`.
    blocked = limit_blocked(project)
    if blocked is not None:
        logger.info(
            "claim blocked by limit project=%s limit=%d in_progress=%d",
            project_slug,
            blocked.limit,
            blocked.in_progress,
        )
        return blocked

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
    """Renew a lease (Doc 01 §8 T6). Returns `(task, seconds_remaining)`.

    An expired deadline is **not** a refusal. The lease is a time estimate, and
    an agent that blows its own estimate still owns the work; the heartbeat is
    how it says "I am alive, still on it, and here is my new estimate". Renewal
    also clears `lease_overdue_at`, which is what takes the row off the overdue
    board.
    """
    now = utcnow()
    with transaction.atomic():
        try:
            task = Task.objects.select_related("project").get(pk=task_id)
        except Task.DoesNotExist:
            raise TaskNotFound("Task not found.", detail={"task_id": str(task_id)}) from None

        if task.status != TaskStatus.IN_PROGRESS:
            raise InvalidTransition(task.status, "heartbeat")

        # A mismatch is a stale lease — mutate nothing (invariant I4). This is
        # the only reason a heartbeat is ever rejected: someone else owns the
        # row now, so this caller must stop working.
        if not task.lease_id or task.lease_id != lease:
            raise StaleLease(
                f"lease_id does not match the live lease for task {task.pk}.",
                detail={"task_id": str(task.pk), "lease_id": lease},
            )

        was_overdue = task.lease_overdue_at is not None
        new_expiry = now + timedelta(seconds=LEASE_TTL_SECONDS)
        Task.objects.filter(pk=task.pk, lease_id=lease).update(
            lease_expires_at=new_expiry,
            lease_overdue_at=None,
            last_heartbeat_at=now,
            updated_at=now,
        )
        task.refresh_from_db()
        audit(
            project=task.project,
            event=AuditEvent.LEASE_RENEWED,
            task_id=task.pk,
            actor=task.assigned_agent_id or "agent",
            detail={"lease_id": lease, "was_overdue": was_overdue},
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
            lease_overdue_at=None,
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


def mark_overdue(*, grace_seconds: int = RECLAIM_GRACE_SECONDS) -> list[Task]:
    """Flag in-progress tasks whose estimated deadline has passed (Doc 03 §5).

    This is the *whole* consequence of a missed estimate: a timestamp and a
    `WARN` line. The task keeps its agent, its lease and its status — throwing
    half-finished work back into the queue because an estimate was optimistic
    is exactly the behaviour this replaced.

    The `UPDATE ... WHERE lease_overdue_at IS NULL` predicate makes the sweep
    idempotent, so the runtime sweeper and the boot janitor can race freely.
    """
    now = utcnow()
    cutoff = now - timedelta(seconds=max(0, grace_seconds))
    marked: list[Task] = []

    candidates = list(
        Task.objects.filter(
            status=TaskStatus.IN_PROGRESS,
            lease_expires_at__lt=cutoff,
            lease_overdue_at__isnull=True,
        )
        .select_related("project")
        .order_by("lease_expires_at")[:200]
    )
    for task in candidates:
        with transaction.atomic():
            updated = Task.objects.filter(
                pk=task.pk,
                status=TaskStatus.IN_PROGRESS,
                lease_overdue_at__isnull=True,
                lease_expires_at__lt=cutoff,
            ).update(lease_overdue_at=now, updated_at=now)
            if updated != 1:
                continue

            task.refresh_from_db()
            marked.append(task)
            overdue_seconds = max(
                0, int((now - task.lease_expires_at).total_seconds())
            )
            emit(
                project=task.project,
                task=task,
                type=EventType.TASK_LEASE_EXPIRED,
                level="WARN",
                message=(
                    f"[OVERDUE] estimated completion time passed "
                    f"{overdue_seconds}s ago; the agent keeps the task."
                ),
                payload={
                    "lease_id": task.lease_id,
                    "assigned_agent_id": task.assigned_agent_id,
                    "lease_expires_at": iso_z(task.lease_expires_at),
                    "overdue_seconds": overdue_seconds,
                },
            )
            audit(
                project=task.project,
                event=AuditEvent.TASK_OVERDUE,
                task_id=task.pk,
                actor="system",
                detail={
                    "lease_id": task.lease_id,
                    "lease_expires_at": iso_z(task.lease_expires_at),
                    "overdue_seconds": overdue_seconds,
                },
            )

    return marked


def clear_lease(task: Task, *, now=None) -> None:
    """Clear lease columns **without** changing status (used by submit/review)."""
    when = now or utcnow()
    Task.objects.filter(pk=task.pk).update(
        lease_id=None,
        lease_expires_at=None,
        lease_overdue_at=None,
        last_heartbeat_at=None,
        updated_at=when,
    )


def seconds_remaining(task: Task, *, now=None) -> int:
    """Seconds until the estimate; `0` once it has passed."""
    if task.lease_expires_at is None:
        return 0
    delta = task.lease_expires_at - (now or utcnow())
    return max(0, int(delta.total_seconds()))


def seconds_overdue(task: Task, *, now=None) -> int:
    """How long the estimate has been blown; `0` while still inside it.

    Deliberately derived from the clock rather than from `lease_overdue_at`, so
    the overdue stopwatch keeps ticking between sweeper runs.
    """
    if task.lease_expires_at is None:
        return 0
    delta = (now or utcnow()) - task.lease_expires_at
    return max(0, int(delta.total_seconds()))


def lease_guard(task: Task, lease: str | None, *, action: str) -> None:
    """Shared precondition for submit/progress/DoD mutations.

    Expiry is not checked: only *ownership* decides whether an agent may act on
    its own task. A missed estimate is reported, never enforced.
    """
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
    "mark_overdue",
    "clear_lease",
    "seconds_remaining",
    "seconds_overdue",
    "lease_guard",
]
