"""Unit tests for progress-based dependency satisfaction (Doc 01 §8).

The rule under test: a `blocked_by` edge is satisfied when the blocker's
Definition of Done hits 100 %, **regardless of status**. Status only matters for
`COMPLETED`, which wins outright so legacy rows without a checklist still
release their dependents. No database is involved — the predicate is pure.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from core.enums import TaskStatus

pytestmark = pytest.mark.django_db


@dataclass
class FakeTask:
    """Minimal stand-in: only the two inputs `is_satisfied` reads."""

    status: str
    dod_progress_percent: int


def test_completed_is_satisfied_even_at_zero_progress():
    from core.dependencies import is_satisfied

    assert is_satisfied(FakeTask(TaskStatus.COMPLETED, 0)) is True


def test_in_review_at_full_progress_is_satisfied():
    """The regression this whole change exists for."""
    from core.dependencies import is_satisfied

    assert is_satisfied(FakeTask(TaskStatus.IN_REVIEW, 100)) is True


def test_in_progress_at_full_progress_is_satisfied():
    from core.dependencies import is_satisfied

    assert is_satisfied(FakeTask(TaskStatus.IN_PROGRESS, 100)) is True


@pytest.mark.parametrize(
    "status",
    [
        TaskStatus.PENDING,
        TaskStatus.PENDING_APPROVAL,
        TaskStatus.IN_PROGRESS,
        TaskStatus.IN_REVIEW,
        TaskStatus.REJECTED,
    ],
)
def test_partial_progress_is_never_satisfied(status):
    from core.dependencies import is_satisfied

    assert is_satisfied(FakeTask(status, 99)) is False
    assert is_satisfied(FakeTask(status, 0)) is False


def test_missing_blocker_is_not_satisfied():
    from core.dependencies import is_satisfied

    assert is_satisfied(None) is False


# ---------------------------------------------------------------------------
# SQL predicate parity (needs real rows: it exercises the annotated subquery)
# ---------------------------------------------------------------------------
def _make(project, *, title, dod):
    from core.services.tasks import create_task

    return create_task(
        project_slug=project.slug,
        title=title,
        description="d",
        priority=50,
        dod_items=dod,
    )


def _tick_all(task):
    from core.models import ChecklistItem
    from core.services import tasks as svc

    for item in ChecklistItem.objects.filter(task=task).order_by("order_index"):
        svc.update_dod_item(task_id=task.pk, item_id=item.order_index, completed=True)


def test_sql_predicate_matches_the_python_predicate(project):
    from core.dependencies import is_satisfied, unsatisfied_blocker_qs
    from core.models import ChecklistItem, Task
    from core.services import tasks as svc

    done = _make(project, title="done", dod=["a"])
    _tick_all(done)

    partial = _make(project, title="partial", dod=["a", "b"])
    first = ChecklistItem.objects.filter(task=partial).order_by("order_index").first()
    svc.update_dod_item(task_id=partial.pk, item_id=first.order_index, completed=True)

    completed_row = _make(project, title="completed", dod=["a"])
    Task.objects.filter(pk=completed_row.pk).update(status=TaskStatus.COMPLETED)

    no_dod = _make(project, title="no dod", dod=["a"])
    ChecklistItem.objects.filter(task=no_dod).delete()

    unsatisfied_ids = set(
        str(pk) for pk in unsatisfied_blocker_qs().values_list("pk", flat=True)
    )
    for task in Task.objects.all():
        refreshed = Task.objects.get(pk=task.pk)
        expected = not is_satisfied(refreshed)
        assert (str(task.pk) in unsatisfied_ids) is expected, (
            f"{refreshed.title} ({refreshed.status}, "
            f"{refreshed.dod_progress_percent}%)"
        )
