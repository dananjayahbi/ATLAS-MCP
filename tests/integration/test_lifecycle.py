"""End-to-end smoke: create → claim → DoD → submit → review."""

from __future__ import annotations

import pytest

from core.enums import TaskStatus

pytestmark = pytest.mark.django_db


def test_full_lifecycle(project, task):
    from core import leases
    from core.services import tasks as svc

    assert task.status == TaskStatus.PENDING
    assert task.checklist.count() == 3

    result = leases.claim_next_task(
        project_slug=project.slug, agent_identifier="Agent-Claude"
    )
    assert result.task.pk == task.pk
    assert result.task.status == TaskStatus.IN_PROGRESS
    assert result.lease_id.startswith("lea_")

    task.refresh_from_db()
    _, percent = svc.update_dod_item(
        task_id=task.pk, item_id=1, completed=True, agent_identifier="Agent-Claude"
    )
    assert percent == 33

    svc.log_progress(task_id=task.pk, message="running: pytest -k race", level="INFO")

    submitted = svc.submit_for_review(
        task_id=task.pk,
        summary_of_work="Added a mutex around refresh.",
        git_patch="--- a/auth.py\n+++ b/auth.py\n@@\n-x\n+y\n",
        verification_log="3 passed",
        agent_identifier="Agent-Claude",
    )
    assert submitted.status == TaskStatus.IN_REVIEW
    assert submitted.lease_id is None
    assert submitted.assets.filter(kind="OUTPUT_PATCH").exists()

    approved = svc.approve_review(task_id=task.pk, note="LGTM")
    assert approved.status == TaskStatus.COMPLETED
    assert approved.completed_at is not None


def test_no_eligible_task_is_a_two_field_payload(project):
    from core import leases

    result = leases.claim_next_task(
        project_slug=project.slug, agent_identifier="Agent-Claude"
    )
    assert isinstance(result, leases.NoEligibleTask)
    assert result.reason == "NO_ELIGIBLE_TASK"
