"""Invariant tests I1–I6 (Doc 01 §11.1): concurrency, leases, atomic writes."""

from __future__ import annotations

import threading
from datetime import timedelta

import pytest

from core.enums import TaskStatus

pytestmark = pytest.mark.django_db(transaction=True)


def test_i2_no_two_concurrent_claims_return_the_same_task(project):
    """I2 — 20 threads racing for 1 task: exactly one wins."""
    from core import leases
    from core.models import Task
    from core.services.tasks import create_task

    create_task(project_slug="alpha", title="Contended", description="d", priority=90)

    results: list = []
    lock = threading.Lock()
    barrier = threading.Barrier(20)

    def worker(index: int) -> None:
        from django.db import connection

        barrier.wait()
        try:
            outcome = leases.claim_next_task(
                project_slug="alpha", agent_identifier=f"Agent-{index}"
            )
            with lock:
                results.append(outcome)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    claims = [r for r in results if isinstance(r, leases.ClaimResult)]
    assert len(claims) == 1, f"expected exactly 1 winner, got {len(claims)}"
    task = Task.objects.get()
    assert task.status == TaskStatus.IN_PROGRESS
    assert task.attempt_count == 1


def test_i1_lease_ids_are_unique_per_claim(project):
    """I1 — distinct claims ⇒ distinct lease ids."""
    from core import leases
    from core.services.tasks import create_task

    seen: set[str] = set()
    for i in range(3):
        create_task(project_slug="alpha", title=f"T{i}", description="d", priority=90)
        result = leases.claim_next_task(
            project_slug="alpha", agent_identifier=f"Agent-{i}"
        )
        assert isinstance(result, leases.ClaimResult)
        assert result.lease_id not in seen
        seen.add(result.lease_id)
        leases.release(task_id=result.task.pk)


def test_i3_in_progress_implies_exactly_one_lease(project, task):
    from core import leases
    from core.models import Task

    leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    row = Task.objects.get(pk=task.pk)
    assert row.lease_id is not None
    assert row.lease_expires_at is not None
    # The inverse must hold too: no lease columns outside IN_PROGRESS.
    leases.release(task_id=task.pk)
    row.refresh_from_db()
    assert row.lease_id is None and row.lease_expires_at is None


def test_i4_stale_lease_mutates_nothing(project, task):
    from core import leases
    from core.errors import StaleLease
    from core.models import Task

    claimed = leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    before = Task.objects.get(pk=task.pk)

    with pytest.raises(StaleLease):
        leases.heartbeat(task_id=task.pk, lease="lea_NOT_REAL")

    after = Task.objects.get(pk=task.pk)
    assert after.lease_expires_at == before.lease_expires_at
    assert after.lease_id == claimed.lease_id


def test_i5_boot_recovery_flags_overdue_leases_without_reclaiming(project, task):
    """A missed estimate is a warning, never a reclaim (Doc 03 §5)."""
    from core import leases
    from core.ids import utcnow
    from core.models import Task

    claimed = leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    # Simulate a blown estimate: the deadline passed well beyond the grace.
    Task.objects.filter(pk=task.pk).update(
        lease_expires_at=utcnow() - timedelta(seconds=3600)
    )

    overdue = leases.mark_overdue(grace_seconds=60)
    assert len(overdue) == 1

    row = Task.objects.get(pk=task.pk)
    # The whole point: the agent keeps its task.
    assert row.status == TaskStatus.IN_PROGRESS
    assert row.lease_id == claimed.lease_id
    assert row.assigned_agent_id == "Agent-X"
    assert row.lease_overdue_at is not None


def test_overdue_marking_is_idempotent(project, task):
    from core import leases
    from core.ids import utcnow
    from core.models import Task

    leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    Task.objects.filter(pk=task.pk).update(
        lease_expires_at=utcnow() - timedelta(seconds=3600)
    )
    assert len(leases.mark_overdue()) == 1
    assert len(leases.mark_overdue()) == 0


def test_heartbeat_after_the_deadline_still_succeeds(project, task):
    """A late agent reports in and continues — no penalty, no reclaim."""
    from core import leases
    from core.ids import utcnow
    from core.models import Task

    claimed = leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    Task.objects.filter(pk=task.pk).update(
        lease_expires_at=utcnow() - timedelta(seconds=3600)
    )
    leases.mark_overdue(grace_seconds=0)
    assert Task.objects.get(pk=task.pk).lease_overdue_at is not None

    renewed, remaining = leases.heartbeat(task_id=task.pk, lease=claimed.lease_id)
    assert remaining == leases.LEASE_TTL_SECONDS

    row = Task.objects.get(pk=task.pk)
    assert row.status == TaskStatus.IN_PROGRESS
    assert row.lease_overdue_at is None, "a heartbeat clears the overdue flag"
    assert row.lease_expires_at > utcnow()


def test_expired_lease_can_still_submit_for_review(project):
    """Only ownership gates submission; an optimistic estimate must not block it."""
    from core import leases
    from core.ids import utcnow
    from core.models import Task
    from core.services import tasks as svc

    task = svc.create_task(
        project_slug="alpha", title="Late work", description="d", priority=80,
        dod_items=["one"],
    )
    leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    Task.objects.filter(pk=task.pk).update(
        lease_expires_at=utcnow() - timedelta(seconds=3600)
    )

    svc.log_progress(task_id=task.pk, message="still going", agent_identifier="Agent-X")
    svc.update_dod_item(task_id=task.pk, item_id=1, completed=True,
                        agent_identifier="Agent-X")
    submitted = svc.submit_for_review(
        task_id=task.pk, summary_of_work="done", git_patch="--- a\n+++ b\n",
        agent_identifier="Agent-X",
    )
    assert submitted.status == TaskStatus.IN_REVIEW
    assert submitted.lease_overdue_at is None


def test_human_force_release_is_the_only_way_to_take_work_back(project, task):
    from core import leases
    from core.ids import utcnow
    from core.models import Task

    leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    Task.objects.filter(pk=task.pk).update(
        lease_expires_at=utcnow() - timedelta(seconds=3600)
    )
    leases.mark_overdue(grace_seconds=0)

    released = leases.release(task_id=task.pk, actor="human")
    assert released.status == TaskStatus.PENDING
    row = Task.objects.get(pk=task.pk)
    assert row.lease_id is None and row.lease_overdue_at is None


def test_i6_atomic_write_leaves_no_partial_file(project, task, tmp_path):
    """I6 — a failing write leaves either the old bytes or nothing, never half."""
    from core.storage import atomic_write_bytes, router
    from core.paths import to_absolute_native

    stored = router.write_task_file(
        project.pk, task.pk, subdir="output", filename="patch.patch", payload=b"first"
    )
    target = to_absolute_native(stored.relative_path)
    assert open(target, "rb").read() == b"first"

    # A payload object that explodes mid-write simulates a killed writer.
    class Exploding(bytes):
        def __new__(cls):
            return super().__new__(cls, b"x")

    with pytest.raises(Exception):
        # Passing a stream whose read() raises proves the temp file never lands.
        class BadStream:
            def read(self, *_):
                raise OSError("simulated disk failure")

        from core.storage import atomic_write_stream

        atomic_write_stream(__import__("pathlib").Path(target), BadStream())

    assert open(target, "rb").read() == b"first", "old bytes must survive"
    leftovers = list(__import__("pathlib").Path(target).parent.glob(".*.tmp"))
    assert leftovers == [], "no temp files may be left behind"


def test_dependency_guard_skips_blocked_tasks_silently(project, task):
    """Doc 01 §8: claim-filter skips a blocked task, never raises."""
    from core import leases
    from core.services.tasks import create_task

    blocker = task
    blocked = create_task(
        project_slug="alpha",
        title="Blocked",
        description="d",
        priority=100,
        blocked_by_ids=[str(blocker.pk)],
    )

    result = leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    assert isinstance(result, leases.ClaimResult)
    assert result.task.pk == blocker.pk, "the higher-priority blocked task is skipped"

    blocked.refresh_from_db()
    assert blocked.status == TaskStatus.PENDING


def test_dependency_cycle_rejected(project, task):
    from core.errors import DependencyCycle
    from core.services import tasks as svc

    child = svc.create_task(
        project_slug="alpha", title="Child", description="d", priority=10
    )
    # child is blocked_by task; wiring task -> blocked_by child closes the loop.
    svc.set_blockers(task_id=child.pk, blocked_by_ids=[str(task.pk)])
    with pytest.raises(DependencyCycle):
        svc.set_blockers(task_id=task.pk, blocked_by_ids=[str(child.pk)])

    with pytest.raises(DependencyCycle):
        svc.set_blockers(task_id=task.pk, blocked_by_ids=[str(task.pk)])


def test_requeue_guard_rejects_a_dead_blocker(project, task):
    """A rejected blocker that never reached 100% DoD can no longer release work."""
    from core.errors import DependencyUnsatisfiable
    from core.models import Task
    from core.services import tasks as svc

    blocker = svc.create_task(
        project_slug="alpha", title="Blocker", description="d", priority=10,
        dod_items=["only item"],
    )
    child = svc.create_task(
        project_slug="alpha",
        title="Needs blocker",
        description="d",
        blocked_by_ids=[str(blocker.pk)],
    )

    Task.objects.filter(pk=blocker.pk).update(status=TaskStatus.REJECTED)
    Task.objects.filter(pk=child.pk).update(status=TaskStatus.REJECTED)

    with pytest.raises(DependencyUnsatisfiable):
        svc.requeue_task(task_id=child.pk)


# ---------------------------------------------------------------------------
# Dependency satisfaction is progress-based, not status-based (Doc 01 §8)
# ---------------------------------------------------------------------------
def _finish_dod(task, *, agent: str = "Agent-Test") -> None:
    from core.models import ChecklistItem
    from core.services import tasks as svc

    svc.log_progress(task_id=task.pk, message="working", agent_identifier=agent)
    for item in ChecklistItem.objects.filter(task=task).order_by("order_index"):
        svc.update_dod_item(
            task_id=task.pk, item_id=item.order_index, completed=True,
            agent_identifier=agent,
        )


def test_in_review_blocker_at_100_percent_releases_dependents(project, task):
    """The whole point of the change: the dependent is claimable from IN_REVIEW."""
    from core import leases
    from core.models import Task
    from core.services import tasks as svc

    blocker = task  # priority 95, three DoD items
    dependent = svc.create_task(
        project_slug="alpha",
        title="User management",
        description="blocked by auth",
        priority=99,
        blocked_by_ids=[str(blocker.pk)],
    )

    # While the blocker is unfinished the dependent stays behind it.
    first = leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-1")
    assert isinstance(first, leases.ClaimResult)
    assert first.task.pk == blocker.pk

    _finish_dod(blocker)
    svc.submit_for_review(
        task_id=blocker.pk, summary_of_work="auth done",
        git_patch="--- a\n+++ b\n", agent_identifier="Agent-1",
    )
    blocker.refresh_from_db()
    assert blocker.status == TaskStatus.IN_REVIEW
    assert blocker.dod_progress_percent == 100

    # The blocker is still IN_REVIEW — never COMPLETED — yet it unlocks work.
    second = leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-2")
    assert isinstance(second, leases.ClaimResult)
    assert second.task.pk == dependent.pk

    dependent.refresh_from_db()
    assert dependent.status == TaskStatus.IN_PROGRESS
    assert Task.objects.get(pk=blocker.pk).status == TaskStatus.IN_REVIEW


def test_blocker_below_100_percent_in_review_still_blocks(project):
    """Only 100% releases an edge; a partially-done blocker keeps it shut."""
    from core import leases
    from core.services import tasks as svc

    blocker = svc.create_task(
        project_slug="alpha", title="Auth", description="d", priority=90,
        dod_items=["a", "b"],
    )
    dependent = svc.create_task(
        project_slug="alpha", title="User mgmt", description="d", priority=100,
        blocked_by_ids=[str(blocker.pk)],
    )

    svc.update_dod_item(task_id=blocker.pk, item_id=1, completed=True)
    assert blocker.dod_progress_percent == 50
    assert dependent.is_blocked() is True

    result = leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    assert isinstance(result, leases.ClaimResult)
    assert result.task.pk == blocker.pk, "the higher-priority dependent is skipped"


def test_completed_blocker_releases_even_without_a_checklist(project):
    """COMPLETED wins outright: a legacy row with no DoD still releases work."""
    from core.models import Task
    from core.services import tasks as svc

    blocker = svc.create_task(
        project_slug="alpha", title="Legacy", description="d", priority=90,
    )
    dependent = svc.create_task(
        project_slug="alpha", title="Child", description="d", priority=50,
        blocked_by_ids=[str(blocker.pk)],
    )
    Task.objects.filter(pk=blocker.pk).update(status=TaskStatus.COMPLETED)

    blocker.refresh_from_db()
    assert blocker.dod_progress_percent == 0
    assert dependent.is_blocked() is False


def test_task_without_checklist_is_never_satisfied_by_progress(project):
    from core.dependencies import is_satisfied
    from core.models import ChecklistItem, Task
    from core.services import tasks as svc

    blocker = svc.create_task(
        project_slug="alpha", title="No DoD", description="d", priority=90,
    )
    ChecklistItem.objects.filter(task=blocker).delete()
    blocker = Task.objects.get(pk=blocker.pk)
    assert blocker.dod_progress_percent == 0
    assert is_satisfied(blocker) is False


def test_blocked_filter_is_progress_based(client, project, task):
    from django.test import override_settings

    from core.models import Task
    from core.services import tasks as svc

    blocker = task
    dependent = svc.create_task(
        project_slug="alpha", title="Needs auth", description="d", priority=80,
        blocked_by_ids=[str(blocker.pk)],
    )

    headers = {"HTTP_AUTHORIZATION": "Bearer test-token"}
    with override_settings(ATLAS_API_TOKEN="test-token"):
        blocked = client.get(
            "/api/v1/projects/alpha/tasks/?blocked=1", **headers
        ).json()["items"]
        assert [row["id"] for row in blocked] == [str(dependent.pk)]

        _finish_dod(blocker)
        # Still PENDING, but 100% done — the edge is released.
        Task.objects.filter(pk=blocker.pk).update(status=TaskStatus.IN_REVIEW)
        blocked = client.get(
            "/api/v1/projects/alpha/tasks/?blocked=1", **headers
        ).json()["items"]
        assert blocked == []
