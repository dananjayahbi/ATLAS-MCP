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


def test_i5_boot_recovery_reclaims_expired_leases(project, task):
    from core import leases
    from core.ids import utcnow
    from core.models import Task

    leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    # Simulate a crash: lease expired well beyond the grace window.
    Task.objects.filter(pk=task.pk).update(
        lease_expires_at=utcnow() - timedelta(seconds=3600)
    )

    reclaimed = leases.reclaim_expired(older_than_seconds=60)
    assert len(reclaimed) == 1

    row = Task.objects.get(pk=task.pk)
    assert row.status == TaskStatus.PENDING
    assert row.lease_id is None
    assert row.lease_expires_at is None


def test_reclaim_is_idempotent(project, task):
    from core import leases
    from core.ids import utcnow
    from core.models import Task

    leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    Task.objects.filter(pk=task.pk).update(
        lease_expires_at=utcnow() - timedelta(seconds=3600)
    )
    assert len(leases.reclaim_expired()) == 1
    assert len(leases.reclaim_expired()) == 0


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


def test_requeue_guard_requires_completed_blockers(project, task):
    from core.errors import DependencyUnsatisfiable
    from core.services import tasks as svc

    blocker = svc.create_task(
        project_slug="alpha", title="Blocker", description="d", priority=10
    )
    child = svc.create_task(
        project_slug="alpha",
        title="Needs blocker",
        description="d",
        blocked_by_ids=[str(blocker.pk)],
    )
    svc.reject_discovery  # noqa: B018 - keep import used
    from core.models import Task

    Task.objects.filter(pk=blocker.pk).update(status=TaskStatus.REJECTED)
    Task.objects.filter(pk=child.pk).update(status=TaskStatus.REJECTED)

    with pytest.raises(DependencyUnsatisfiable):
        svc.requeue_task(task_id=child.pk)
