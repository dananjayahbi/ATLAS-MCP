"""Task service: transitions T1–T14 (Doc 01 §8).

Every function is a thin, testable wrapper that enforces one row of the guard
table. HTTP views and MCP tools both call into here; neither re-implements a
guard.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Iterable

from django.db import transaction

from core import leases
from core.audit import audit
from core.enums import AuditEvent, EventType, TaskStatus
from core.errors import (
    DependencyCycle,
    DependencyUnsatisfiable,
    InvalidTransition,
    ProjectNotFound,
    TaskNotFound,
    ValidationError,
)
from core.events import emit
from core.ids import utcnow
from core.models import Asset, ChecklistItem, Project, Task
from core.storage import router

logger = logging.getLogger("atlas.services.tasks")


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------
def get_project(slug: str) -> Project:
    try:
        return Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        raise ProjectNotFound(f"No project with slug '{slug}'.", detail={"slug": slug}) from None


def get_task(task_id) -> Task:
    try:
        return Task.objects.select_related("project").get(pk=task_id)
    except (Task.DoesNotExist, ValueError, TypeError):
        raise TaskNotFound("Task not found.", detail={"task_id": str(task_id)}) from None


# ---------------------------------------------------------------------------
# Dependency graph helpers
# ---------------------------------------------------------------------------
def would_create_cycle(task: Task, new_blockers: Iterable[Task]) -> bool:
    """True when adding `new_blockers` would close a cycle through `task`."""
    target = task.pk
    stack = [b.pk for b in new_blockers]
    seen: set = set()
    while stack:
        current = stack.pop()
        if current == target:
            return True
        if current in seen:
            continue
        seen.add(current)
        stack.extend(
            Task.blocked_by.through.objects.filter(from_task_id=current)
            .values_list("to_task_id", flat=True)
        )
    return False


def assert_dependencies_satisfiable(task: Task) -> None:
    """Explicit-intent guard (Doc 01 §8): raises on a REJECTED blocker."""
    rejected = list(task.blocked_by.filter(status=TaskStatus.REJECTED))
    if rejected:
        raise DependencyUnsatisfiable(
            "A blocker was rejected and must be requeued or removed first.",
            detail={"blocker_id": str(rejected[0].pk)},
        )


# ---------------------------------------------------------------------------
# T1 — create_task (human)
# ---------------------------------------------------------------------------
@transaction.atomic
def set_blockers(*, task_id, blocked_by_ids, actor: str = "human") -> Task:
    """Re-wire a task's dependencies, rejecting cycles (Doc 01 §8 T1 guard).

    A cycle can only be introduced on an existing task: a brand-new task has no
    incoming edges yet, so `create_task`'s guard is trivially satisfiable.
    """
    task = get_task(task_id)
    blockers = _load_blockers(blocked_by_ids)

    if any(str(b.pk) == str(task.pk) for b in blockers):
        raise DependencyCycle(
            "A task cannot block itself.", detail={"task_id": str(task.pk)}
        )
    if blockers and would_create_cycle(task, blockers):
        raise DependencyCycle(
            "blocked_by would create a cycle.",
            detail={"task_id": str(task.pk), "blocked_by": [str(b.pk) for b in blockers]},
        )

    task.blocked_by.set(blockers)
    emit(
        project=task.project,
        task=task,
        type=EventType.TASK_UPDATED,
        message="Dependencies updated",
        payload={"blocked_by": [str(b.pk) for b in blockers]},
    )
    audit(
        project=task.project,
        event=AuditEvent.TASK_STATUS,
        task_id=task.pk,
        actor=actor,
        detail={"blocked_by": [str(b.pk) for b in blockers]},
    )
    return task


@transaction.atomic
def create_task(
    *,
    project_slug: str,
    title: str,
    description: str,
    priority: int = 50,
    dod_items: Iterable[str] | None = None,
    blocked_by_ids: Iterable[str] | None = None,
    parent_task_id: str | None = None,
    actor: str = "human",
) -> Task:
    project = get_project(project_slug)
    _assert_text(title, "title", 200)
    _assert_text(description, "description", 20_000)
    _assert_priority(priority)

    blockers = _load_blockers(blocked_by_ids)
    parent = get_task(parent_task_id) if parent_task_id else None

    task = Task.objects.create(
        project=project,
        title=title.strip(),
        description=description,
        priority=priority,
        status=TaskStatus.PENDING,
        parent_task=parent,
    )
    if blockers:
        if would_create_cycle(task, blockers):
            raise DependencyCycle(
                "blocked_by would create a cycle.",
                detail={"task_id": str(task.pk)},
            )
        task.blocked_by.set(blockers)

    _create_checklist(task, dod_items)
    router.scaffold_task(project.pk, task.pk)
    _write_task_meta(task)

    audit(project=project, event=AuditEvent.TASK_CREATED, task_id=task.pk,
          actor=actor, detail={"title": task.title})
    emit(project=project, task=task, type=EventType.TASK_CREATED,
         message=f"Task created: {task.title}", payload={"priority": priority})
    return task


# ---------------------------------------------------------------------------
# T2 — propose_task (agent discovery)
# ---------------------------------------------------------------------------
@transaction.atomic
def propose_task(
    *,
    project_slug: str,
    title: str,
    description: str,
    suggested_priority: int,
    discovered_during_task_id: str,
    discovered_by_agent: str,
    discovery_reason: str = "",
    screenshot_paths: Iterable[str] | None = None,
) -> Task:
    project = get_project(project_slug)
    _assert_text(title, "title", 200)
    _assert_text(description, "description", 20_000)
    _assert_priority(suggested_priority)
    origin = get_task(discovered_during_task_id)

    task = Task.objects.create(
        project=project,
        title=title.strip(),
        description=description,
        priority=suggested_priority,
        suggested_priority=suggested_priority,
        status=TaskStatus.PENDING_APPROVAL,
        is_agent_discovered=True,
        discovered_during_task=origin,
        discovered_by_agent=discovered_by_agent,
        discovery_reason=discovery_reason,
    )
    router.scaffold_task(project.pk, task.pk)
    _ingest_screenshots(task, screenshot_paths)
    _write_task_meta(task)

    audit(project=project, event=AuditEvent.DISCOVERY_PROPOSED, task_id=task.pk,
          actor=discovered_by_agent, detail={"during": str(origin.pk)})
    emit(project=project, task=task, type=EventType.DISCOVERY_CREATED,
         message=f"Discovery proposed: {task.title}",
         payload={"suggested_priority": suggested_priority,
                  "discovered_during_task_id": str(origin.pk)})
    return task


# ---------------------------------------------------------------------------
# T3 / T4 — discovery triage
# ---------------------------------------------------------------------------
@transaction.atomic
def approve_discovery(*, task_id, priority: int | None = None, actor: str = "human") -> Task:
    task = get_task(task_id)
    if task.status != TaskStatus.PENDING_APPROVAL:
        raise InvalidTransition(task.status, "approve_discovery")

    new_priority = priority if priority is not None else (task.suggested_priority or task.priority)
    _assert_priority(new_priority)

    Task.objects.filter(pk=task.pk, status=TaskStatus.PENDING_APPROVAL).update(
        status=TaskStatus.PENDING, priority=new_priority, updated_at=utcnow()
    )
    task.refresh_from_db()
    audit(project=task.project, event=AuditEvent.DISCOVERY_APPROVED, task_id=task.pk,
          actor=actor, detail={"priority": new_priority})
    emit(project=task.project, task=task, type=EventType.DISCOVERY_APPROVED,
         message=f"Discovery approved: {task.title}", payload={"priority": new_priority})
    return task


@transaction.atomic
def reject_discovery(*, task_id, note: str = "", actor: str = "human") -> Task:
    task = get_task(task_id)
    if task.status != TaskStatus.PENDING_APPROVAL:
        raise InvalidTransition(task.status, "reject_discovery")

    Task.objects.filter(pk=task.pk, status=TaskStatus.PENDING_APPROVAL).update(
        status=TaskStatus.REJECTED, review_notes=note, updated_at=utcnow()
    )
    task.refresh_from_db()
    audit(project=task.project, event=AuditEvent.DISCOVERY_REJECTED, task_id=task.pk,
          actor=actor, detail={"note": note})
    emit(project=task.project, task=task, type=EventType.DISCOVERY_REJECTED,
         message=f"Discovery rejected: {task.title}")
    return task


# ---------------------------------------------------------------------------
# T7 — submit_for_review
# ---------------------------------------------------------------------------
@transaction.atomic
def submit_for_review(
    *,
    task_id,
    summary_of_work: str,
    git_patch: str,
    verification_log: str | None = None,
    agent_identifier: str | None = None,
) -> Task:
    task = get_task(task_id)
    if task.status not in (TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW):
        raise InvalidTransition(task.status, "submit_for_review")
    if not git_patch.strip():
        raise ValidationError("git_patch must be a non-empty unified diff.",
                              detail={"field": "git_patch"})
    if len(git_patch.encode("utf-8")) > 5 * 1024 * 1024:
        from core.errors import PayloadTooLarge

        raise PayloadTooLarge("git_patch exceeds 5 MB.", detail={"max_bytes": 5 * 1024 * 1024})

    if task.status == TaskStatus.IN_PROGRESS:
        _assert_live_lease(task, "submit_for_review")

    project = task.project
    patch = git_patch.encode("utf-8")
    _store_output(task, "git_patch.patch", patch, kind="OUTPUT_PATCH", mime="text/plain")
    if verification_log:
        _store_output(task, "test_execution.log", verification_log.encode("utf-8"),
                      kind="TEST_LOG", mime="text/plain")

    now = utcnow()
    Task.objects.filter(pk=task.pk).update(
        status=TaskStatus.IN_REVIEW,
        review_summary=summary_of_work,
        submitted_at=now,
        assigned_agent_id=agent_identifier or task.assigned_agent_id,
        lease_id=None,
        lease_expires_at=None,
        last_heartbeat_at=None,
        updated_at=now,
    )
    task.refresh_from_db()
    audit(project=project, event=AuditEvent.SUBMITTED, task_id=task.pk,
          actor=agent_identifier or task.assigned_agent_id or "agent",
          detail={"patch_bytes": len(patch)})
    emit(project=project, task=task, type=EventType.TASK_SUBMITTED,
         message=f"Submitted for review: {task.title}",
         payload={"dod_progress_percent": task.dod_progress_percent})
    return task


# ---------------------------------------------------------------------------
# T8 / T9 — review decisions
# ---------------------------------------------------------------------------
@transaction.atomic
def approve_review(*, task_id, note: str = "", actor: str = "human") -> Task:
    task = get_task(task_id)
    if task.status != TaskStatus.IN_REVIEW:
        raise InvalidTransition(task.status, "approve_review")

    now = utcnow()
    Task.objects.filter(pk=task.pk, status=TaskStatus.IN_REVIEW).update(
        status=TaskStatus.COMPLETED, completed_at=now, review_notes=note, updated_at=now
    )
    task.refresh_from_db()
    audit(project=task.project, event=AuditEvent.REVIEW_APPROVED, task_id=task.pk,
          actor=actor, detail={"note": note})
    emit(project=task.project, task=task, type=EventType.REVIEW_APPROVED,
         message=f"Review approved: {task.title}")
    return task


@transaction.atomic
def reject_review(*, task_id, note: str, actor: str = "human") -> Task:
    if not note or not note.strip():
        raise ValidationError("review_notes is required when rejecting a review.",
                              detail={"field": "note"})
    task = get_task(task_id)
    if task.status != TaskStatus.IN_REVIEW:
        raise InvalidTransition(task.status, "reject_review")

    now = utcnow()
    Task.objects.filter(pk=task.pk, status=TaskStatus.IN_REVIEW).update(
        status=TaskStatus.PENDING,
        review_notes=note,
        submitted_at=None,
        lease_id=None,
        lease_expires_at=None,
        updated_at=now,
    )
    task.refresh_from_db()
    audit(project=task.project, event=AuditEvent.REVIEW_REJECTED, task_id=task.pk,
          actor=actor, detail={"note": note})
    emit(project=task.project, task=task, type=EventType.REVIEW_REJECTED,
         message=f"Review rejected (rework): {task.title}", level="WARN")
    return task


# ---------------------------------------------------------------------------
# T12 / T13 — archive & requeue
# ---------------------------------------------------------------------------
@transaction.atomic
def archive_task(*, task_id, actor: str = "human") -> Task:
    task = get_task(task_id)
    if task.status not in (TaskStatus.PENDING, TaskStatus.REJECTED):
        raise InvalidTransition(task.status, "archive_task")

    now = utcnow()
    Task.objects.filter(pk=task.pk).update(status=TaskStatus.REJECTED, updated_at=now)
    task.refresh_from_db()
    audit(project=task.project, event=AuditEvent.TASK_STATUS, task_id=task.pk,
          actor=actor, detail={"to": TaskStatus.REJECTED})
    emit(project=task.project, task=task, type=EventType.TASK_STATUS_CHANGED,
         message=f"{TaskStatus.PENDING} -> {TaskStatus.REJECTED} (archived)")
    return task


@transaction.atomic
def requeue_task(*, task_id, actor: str = "human") -> Task:
    task = get_task(task_id)
    if task.status != TaskStatus.REJECTED:
        raise InvalidTransition(task.status, "requeue_task")
    assert_dependencies_satisfiable(task)

    now = utcnow()
    Task.objects.filter(pk=task.pk, status=TaskStatus.REJECTED).update(
        status=TaskStatus.PENDING, review_notes="", updated_at=now
    )
    task.refresh_from_db()
    audit(project=task.project, event=AuditEvent.TASK_STATUS, task_id=task.pk,
          actor=actor, detail={"to": TaskStatus.PENDING, "action": "requeue"})
    emit(project=task.project, task=task, type=EventType.TASK_STATUS_CHANGED,
         message=f"{TaskStatus.REJECTED} -> {TaskStatus.PENDING} (requeued)")
    return task


# ---------------------------------------------------------------------------
# Priority / DoD / log / subtask
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Human edits: metadata, manual status, dependency rewiring
# ---------------------------------------------------------------------------
EDITABLE_FIELDS = ("title", "description", "priority")


def _assert_edit_lock(task: Task, action: str) -> None:
    """Completed work is evidence, not a draft — editing it would rewrite history."""
    if task.status == TaskStatus.COMPLETED:
        raise InvalidTransition(task.status, action)


@transaction.atomic
def update_task(
    *,
    task_id,
    title: str | None = None,
    description: str | None = None,
    priority: int | None = None,
    blocked_by_ids: Iterable[str] | None = None,
    dod_items: Iterable[str] | None = None,
    actor: str = "human",
) -> Task:
    """`PATCH /tasks/{id}/` — metadata, dependencies and the DoD checklist.

    Status is deliberately absent: it has its own route so the guard table
    (Doc 01 §8) keeps exactly one implementation per transition.
    """
    task = get_task(task_id)
    _assert_edit_lock(task, "update_task")

    changes: dict[str, Any] = {}
    if title is not None:
        _assert_text(title, "title", 200)
        changes["title"] = title.strip()
    if description is not None:
        _assert_text(description, "description", 20_000)
        changes["description"] = description
    if priority is not None:
        _assert_priority(priority)
        changes["priority"] = priority

    if changes:
        changes["updated_at"] = utcnow()
        Task.objects.filter(pk=task.pk).update(**changes)
        task.refresh_from_db()

    if blocked_by_ids is not None:
        set_blockers(task_id=task.pk, blocked_by_ids=blocked_by_ids, actor=actor)
        task.refresh_from_db()

    if dod_items is not None:
        _replace_checklist(task, dod_items)

    if changes or dod_items is not None:
        audit(project=task.project, event=AuditEvent.TASK_STATUS, task_id=task.pk,
              actor=actor, detail={"edited": sorted(changes) or ["definition_of_done"]})
        emit(project=task.project, task=task, type=EventType.TASK_UPDATED,
             message=f"Task updated: {task.title}")
    return task


@transaction.atomic
def _replace_checklist(task: Task, items: Iterable[str]) -> None:
    """Rewrite the DoD while preserving completion of untouched labels.

    Toggling completion is the auditable event (`dod_toggle`), so a rewrite
    keeps the flag for every label that survives instead of resetting progress
    the operator never meant to touch.
    """
    labels = [str(i).strip()[:200] for i in items if str(i).strip()]
    if not labels:
        raise ValidationError("definition_of_done cannot be empty.",
                              detail={"field": "dod_items"})
    if len(labels) > 50:
        raise ValidationError("definition_of_done is capped at 50 items.",
                              detail={"field": "dod_items", "max": 50})

    existing = {item.label: item for item in task.checklist.all()}
    keep = []
    for index, label in enumerate(labels, 1):
        previous = existing.get(label)
        keep.append(
            ChecklistItem(
                task=task,
                order_index=index,
                label=label,
                completed=previous.completed if previous else False,
                completed_at=previous.completed_at if previous else None,
                completed_by_agent=previous.completed_by_agent if previous else None,
            )
        )

    # The unique (task, order_index) constraint blocks an in-place renumber, so
    # the old rows go first inside the same transaction.
    task.checklist.all().delete()
    ChecklistItem.objects.bulk_create(keep)
    task.refresh_from_db()


@transaction.atomic
def set_status(*, task_id, to: str, note: str = "", actor: str = "human") -> Task:
    """Explicit human override of status.

    Only the transitions a human is allowed to drive directly are reachable here;
    everything else must go through its dedicated action so the guard table
    (Doc 01 §8) keeps exactly one implementation per transition.
    """
    task = get_task(task_id)
    current = task.status
    if to not in TaskStatus.values:
        raise ValidationError("Unknown status.", detail={"field": "to", "value": to})
    if to == current:
        raise InvalidTransition(current, f"set_status:{to}", "Task is already in that status.")

    # T12 / T13 / T11 — the reversible human moves.
    if to == TaskStatus.REJECTED:
        return archive_task(task_id=task.pk, actor=actor)
    if to == TaskStatus.PENDING and current == TaskStatus.REJECTED:
        return requeue_task(task_id=task.pk, actor=actor)
    if to == TaskStatus.PENDING and current == TaskStatus.IN_PROGRESS:
        return leases.release(task_id=task.pk, actor=actor, reason="manual_release")
    # T8 / T9 — review decisions keep their notes contract.
    if to == TaskStatus.COMPLETED:
        return approve_review(task_id=task.pk, note=note, actor=actor)
    if to == TaskStatus.PENDING and current == TaskStatus.IN_REVIEW:
        return reject_review(task_id=task.pk, note=note or "Reopened by operator.", actor=actor)
    # T5 / T14 — an operator may hand a queued task to an agent.
    if to == TaskStatus.IN_PROGRESS and current == TaskStatus.PENDING:
        agent = task.assigned_agent_id or _default_agent_identifier()
        leases.claim_specific_task(task_id=task.pk, agent_identifier=agent)
        return get_task(task.pk)

    raise InvalidTransition(current, f"set_status:{to}")


@transaction.atomic
def set_assignee(*, task_id, agent_identifier: str | None, actor: str = "human") -> Task:
    """Manual assignee override.

    A lease is what actually claims work; `assigned_agent_id` alone is a hint.
    Rebinding a task that is already `IN_PROGRESS` is therefore refused unless
    the operator releases it first, otherwise two agents would believe they own
    the same row.
    """
    task = get_task(task_id)
    value = (agent_identifier or "").strip() or None
    if task.status == TaskStatus.IN_PROGRESS and task.lease_id:
        raise InvalidTransition(
            task.status,
            "set_assignee",
            "Release the live lease before reassigning this task.",
        )
    Task.objects.filter(pk=task.pk).update(assigned_agent_id=value, updated_at=utcnow())
    task.refresh_from_db()
    audit(project=task.project, event=AuditEvent.TASK_STATUS, task_id=task.pk,
          actor=actor, detail={"assigned_agent_id": value})
    emit(project=task.project, task=task, type=EventType.TASK_UPDATED,
         message=f"Assignee set to {value or 'unassigned'}: {task.title}",
         payload={"assigned_agent_id": value})
    return task


@transaction.atomic
def delete_task(*, task_id, actor: str = "human") -> None:
    """Hard delete, only before any agent has touched the row.

    Doc 01 §8 T12 makes `archive` the normal removal; a genuine delete exists
    for mistakes made seconds earlier and is fenced by evidence: a task that was
    ever claimed, submitted, or carries stored assets must be archived instead.
    """
    task = get_task(task_id)
    if task.status not in (TaskStatus.PENDING, TaskStatus.REJECTED):
        raise InvalidTransition(task.status, "delete_task")
    if task.attempt_count > 0 or task.claimed_at or task.submitted_at:
        raise InvalidTransition(
            task.status,
            "delete_task",
            "A task that has been claimed cannot be deleted; archive it instead.",
        )
    if Asset.objects.filter(task=task).exists():
        raise InvalidTransition(
            task.status,
            "delete_task",
            "A task with stored assets cannot be deleted; archive it instead.",
        )

    project = task.project
    title = task.title
    # Emit before the row disappears: `TaskEvent.task` is SET_NULL, so the
    # envelope's `task_id` has to be captured while the task still exists.
    emit(project=project, task=task, type=EventType.TASK_UPDATED,
         message=f"Task deleted: {title}", payload={"deleted": True})
    audit(project=project, event=AuditEvent.TASK_STATUS, task_id=task.pk,
          actor=actor, detail={"deleted": True, "title": title})
    task.delete()


def _default_agent_identifier() -> str:
    return "Agent-Manual"


@transaction.atomic
def set_priority(*, task_id, priority: int, actor: str = "human") -> Task:
    _assert_priority(priority)
    task = get_task(task_id)
    old = task.priority
    Task.objects.filter(pk=task.pk).update(priority=priority, updated_at=utcnow())
    task.refresh_from_db()
    audit(project=task.project, event=AuditEvent.TASK_PRIORITY, task_id=task.pk,
          actor=actor, detail={"from": old, "to": priority})
    emit(project=task.project, task=task, type=EventType.TASK_PRIORITY_CHANGED,
         message=f"Priority {old} -> {priority}", payload={"from": old, "to": priority})
    return task


@transaction.atomic
def update_dod_item(
    *, task_id, item_id: int, completed: bool, agent_identifier: str | None = None
) -> tuple[Task, int]:
    task = get_task(task_id)
    try:
        item = ChecklistItem.objects.get(task=task, order_index=item_id)
    except ChecklistItem.DoesNotExist:
        raise ValidationError("DoD item not found.", detail={"item_id": item_id}) from None

    now = utcnow()
    item.completed = completed
    item.completed_at = now if completed else None
    item.completed_by_agent = agent_identifier if completed else None
    item.save(update_fields=["completed", "completed_at", "completed_by_agent"])

    audit(project=task.project, event=AuditEvent.DOD_TOGGLE, task_id=task.pk,
          actor=agent_identifier or "human",
          detail={"item_id": item_id, "completed": completed})
    emit(project=task.project, task=task, type=EventType.TASK_DOD_UPDATED,
         message=f"DoD item {item_id} {'completed' if completed else 'reopened'}",
         payload={"item_id": item_id, "completed": completed})
    task.refresh_from_db()
    return task, task.dod_progress_percent


@transaction.atomic
def spawn_subtask(
    *,
    parent_task_id,
    title: str,
    description: str,
    priority: int,
    actor: str = "agent",
) -> Task:
    parent = get_task(parent_task_id)
    _assert_text(title, "title", 200)
    _assert_priority(priority)

    child = Task.objects.create(
        project=parent.project,
        title=title.strip(),
        description=description,
        priority=priority,
        status=TaskStatus.PENDING,
        parent_task=parent,
        discovered_during_task=parent,
        is_agent_discovered=True,
        discovered_by_agent=actor,
    )
    router.scaffold_task(parent.project.pk, child.pk)
    _write_task_meta(child)
    audit(project=parent.project, event=AuditEvent.SUBTASK_SPAWNED, task_id=child.pk,
          actor=actor, detail={"parent_task_id": str(parent.pk)})
    emit(project=parent.project, task=child, type=EventType.TASK_CREATED,
         message=f"Subtask spawned: {child.title}",
         payload={"parent_task_id": str(parent.pk)})
    return child


def log_progress(
    *, task_id, message: str, level: str = "INFO", agent_identifier: str | None = None
) -> None:
    """Append to `execution.log` and broadcast `task.log` (Doc 01 §9.5)."""
    from core.enums import LogLevel
    from core.events import emit
    from core.sanitise import sanitise_log_message

    if level not in LogLevel.values:
        raise ValidationError("Unknown log level.", detail={"level": level})
    task = get_task(task_id)
    clean = sanitise_log_message(message)
    with transaction.atomic():
        router.append_execution_log(task.project.pk, task.pk, f"[{level}] {clean}")
        emit(project=task.project, task=task, type=EventType.TASK_LOG,
             level=level, message=clean,
             payload={"source": "mcp", "agent_identifier": agent_identifier})


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------
def _assert_text(value: str, field: str, max_len: int) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{field} must be a non-empty string.",
                              detail={"field": field})
    if len(value) > max_len:
        raise ValidationError(f"{field} exceeds {max_len} characters.",
                              detail={"field": field, "max_len": max_len})


def _assert_priority(value: int) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValidationError("priority must be an integer.", detail={"field": "priority"})
    if not 0 <= value <= 100:
        raise ValidationError("priority must be between 0 and 100.",
                              detail={"field": "priority", "value": value})


def _assert_live_lease(task: Task, action: str) -> None:
    if task.status != TaskStatus.IN_PROGRESS:
        return
    expiry = task.lease_expires_at
    now = utcnow()
    if expiry is None or expiry + timedelta(seconds=leases.RECLAIM_GRACE_SECONDS) < now:
        raise InvalidTransition(task.status, action,
                                "Lease expired; wait for the reclaim sweep.")


def _load_blockers(ids: Iterable[str] | None) -> list[Task]:
    if not ids:
        return []
    rows = list(Task.objects.filter(pk__in=list(ids)))
    if len(rows) != len(set(map(str, ids))):
        raise ValidationError("One or more blocked_by ids do not exist.",
                              detail={"field": "blocked_by"})
    return rows


def _create_checklist(task: Task, items: Iterable[str] | None) -> None:
    labels = [i for i in (items or []) if i and i.strip()]
    if not labels:
        labels = ["Implementation complete", "Tests passing", "Docs updated"]
    ChecklistItem.objects.bulk_create(
        [
            ChecklistItem(task=task, order_index=i, label=label.strip()[:200])
            for i, label in enumerate(labels, 1)
        ]
    )


def _ingest_screenshots(task: Task, paths: Iterable[str] | None) -> None:
    from core.enums import AssetKind, AssetSource
    from core.services.assets import register_stored_file

    for raw in list(paths or [])[:20]:
        try:
            stored = router.copy_into_task(
                task.project_id, task.pk, source_path=raw, subdir="output"
            )
        except Exception as exc:  # containment/IO failure must not lose the task
            logger.warning("screenshot ingest failed for %s: %s", raw, exc)
            continue
        register_stored_file(
            task=task, stored=stored, kind=AssetKind.VERIFICATION_IMAGE,
            mime_type="image/png", source=AssetSource.AGENT,
        )


def _store_output(task: Task, filename: str, payload: bytes, *, kind: str, mime: str) -> Asset:
    from core.enums import AssetSource
    from core.services.assets import register_stored_file

    stored = router.write_task_file(
        task.project_id, task.pk, subdir="output", filename=filename, payload=payload
    )
    return register_stored_file(
        task=task, stored=stored, kind=kind, mime_type=mime, source=AssetSource.AGENT
    )


def _write_task_meta(task: Task) -> None:
    """Offline mirror so the folder is self-describing without the DB (Doc 02 §8.5)."""
    import json

    payload: dict[str, Any] = {
        "task_id": str(task.pk),
        "project_slug": task.project.slug,
        "title": task.title,
        "status": task.status,
        "priority": task.priority,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "is_agent_discovered": task.is_agent_discovered,
    }
    path = router.task_dir(task.project_id, task.pk) / "meta.json"
    from core.storage import atomic_write_bytes

    atomic_write_bytes(path, json.dumps(payload, indent=2).encode("utf-8"))


__all__ = [
    "get_project",
    "get_task",
    "would_create_cycle",
    "assert_dependencies_satisfiable",
    "set_blockers",
    "create_task",
    "propose_task",
    "approve_discovery",
    "reject_discovery",
    "submit_for_review",
    "approve_review",
    "reject_review",
    "archive_task",
    "requeue_task",
    "set_priority",
    "update_dod_item",
    "spawn_subtask",
    "log_progress",
]
