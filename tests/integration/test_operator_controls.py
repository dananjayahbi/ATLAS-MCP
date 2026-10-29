"""Operator-controls series: claim limits, review gates, archive, search, thumbs.

Every test here pins a rule the operator asked for, so a later refactor cannot
quietly re-open it:

* a project caps how many tasks an agent may hold at once, and only a human can
  raise that cap;
* `submit_for_review` refuses to run without a progress log and a 100 % DoD;
* any task can be archived, and restoring one resets its progress;
* an agent can filter tasks instead of pulling the whole board;
* image uploads produce a thumbnail the board can use.
"""

from __future__ import annotations

import io

import pytest

from core.enums import TaskStatus

pytestmark = pytest.mark.django_db

AUTH = {"HTTP_AUTHORIZATION": "Bearer test-token"}

#: `/internal/v1` additionally requires the agent header (Doc 01 §14.2).
AGENT_AUTH = {"HTTP_X_ATLAS_AGENT": "Agent-Test"}
INTERNAL_AUTH = {**AUTH, **AGENT_AUTH}


def _png_bytes(width: int = 800, height: int = 600) -> bytes:
    """A real PNG, so the thumbnail path actually decodes something."""
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (12, 34, 56)).save(buffer, format="PNG")
    return buffer.getvalue()


def _claim(project, agent: str = "Agent-X"):
    from core import leases

    return leases.claim_next_task(project_slug=project.slug, agent_identifier=agent)


def _new_task(project, title: str, *, priority: int = 50, description: str | None = None):
    from core.services.tasks import create_task

    return create_task(
        project_slug=project.slug,
        title=title,
        description=description or f"{title} description",
        priority=priority,
        dod_items=["one"],
    )


# ---------------------------------------------------------------------------
# 1. per-project claim limit
# ---------------------------------------------------------------------------
def test_claim_limit_blocks_once_the_ceiling_is_spent(project):
    from core import leases
    from core.models import Project

    Project.objects.filter(pk=project.pk).update(claim_limit=2)
    for index in range(3):
        _new_task(project, f"Task {index}")

    assert isinstance(_claim(project), leases.ClaimResult)
    assert isinstance(_claim(project), leases.ClaimResult)

    blocked = _claim(project)
    assert isinstance(blocked, leases.ClaimLimitReached)
    assert blocked.limit == 2
    assert blocked.in_progress == 2
    assert blocked.reason == "CLAIM_LIMIT_REACHED"


def test_claim_limit_zero_means_unlimited(project):
    from core import leases
    from core.models import Project

    Project.objects.filter(pk=project.pk).update(claim_limit=0)
    for index in range(4):
        _new_task(project, f"Task {index}")

    for _ in range(4):
        assert isinstance(_claim(project), leases.ClaimResult)


def test_submitting_frees_a_claim_slot(project):
    from core import leases
    from core.models import Project
    from tests.conftest import drive_to_review

    Project.objects.filter(pk=project.pk).update(claim_limit=1)
    first = _new_task(project, "First")
    _new_task(project, "Second")

    claimed = _claim(project)
    assert isinstance(claimed, leases.ClaimResult)
    assert isinstance(_claim(project), leases.ClaimLimitReached)

    drive_to_review(first, agent="Agent-X")
    # The finished task is IN_REVIEW, so the slot is free again.
    assert isinstance(_claim(project), leases.ClaimResult)


def test_archiving_live_work_frees_a_claim_slot(project):
    from core import leases
    from core.models import Project
    from core.services.tasks import archive_task

    Project.objects.filter(pk=project.pk).update(claim_limit=1)
    first = _new_task(project, "First")
    _new_task(project, "Second")

    _claim(project)
    assert isinstance(_claim(project), leases.ClaimLimitReached)

    archive_task(task_id=first.pk)
    assert isinstance(_claim(project), leases.ClaimResult)


def test_claim_route_reports_the_limit_instead_of_an_empty_queue(client, project):
    from core.models import Project

    Project.objects.filter(pk=project.pk).update(claim_limit=1)
    _new_task(project, "Only")
    _new_task(project, "Also")

    first = client.post(
        "/internal/v1/claim",
        data={"project_slug": project.slug, "agent_identifier": "Agent-X"},
        content_type="application/json",
        **INTERNAL_AUTH,
    )
    assert first.status_code == 200, first.content
    assert first.json()["task_id"] is not None

    second = client.post(
        "/internal/v1/claim",
        data={"project_slug": project.slug, "agent_identifier": "Agent-X"},
        content_type="application/json",
        **INTERNAL_AUTH,
    )
    body = second.json()
    assert body["task_id"] is None
    assert body["reason"] == "CLAIM_LIMIT_REACHED"
    assert body["claim_limit"] == 1
    assert "request_claim_limit" in body["hint"]


# ---------------------------------------------------------------------------
# 2. an agent cannot raise its own limit
# ---------------------------------------------------------------------------
def test_request_claim_limit_creates_a_pending_request_without_changing_the_limit(
    client, project
):
    from core.models import Project

    Project.objects.filter(pk=project.pk).update(claim_limit=2)
    response = client.post(
        "/internal/v1/claim-limit",
        data={
            "project_slug": project.slug,
            "requested_limit": 6,
            "reason": "Six independent POS-terminal fixes are queued.",
        },
        content_type="application/json",
        **INTERNAL_AUTH,
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "PENDING"
    assert body["current_limit"] == 2
    assert body["requested_limit"] == 6

    # The whole point: asking never moves the ceiling.
    assert Project.objects.get(pk=project.pk).claim_limit == 2


def test_request_claim_limit_must_exceed_the_current_limit(client, project):
    response = client.post(
        "/internal/v1/claim-limit",
        data={"project_slug": project.slug, "requested_limit": 2, "reason": "same"},
        content_type="application/json",
        **INTERNAL_AUTH,
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_operator_approval_applies_the_requested_limit(client, project):
    from core.models import Project

    Project.objects.filter(pk=project.pk).update(claim_limit=2)
    created = client.post(
        "/internal/v1/claim-limit",
        data={"project_slug": project.slug, "requested_limit": 7, "reason": "more"},
        content_type="application/json",
        **INTERNAL_AUTH,
    ).json()

    listed = client.get(
        f"/api/v1/claim-limit-requests/?project_slug={project.slug}", **AUTH
    )
    assert listed.status_code == 200, listed.content
    assert [row["id"] for row in listed.json()["items"]] == [created["request_id"]]

    resolved = client.post(
        f"/api/v1/claim-limit-requests/{created['request_id']}/resolve/",
        data={"approve": True, "note": "Parallel branches are independent."},
        content_type="application/json",
        **AUTH,
    )
    assert resolved.status_code == 200, resolved.content
    assert resolved.json()["status"] == "APPROVED"
    assert Project.objects.get(pk=project.pk).claim_limit == 7


def test_operator_dismissal_leaves_the_limit_alone(client, project):
    from core.models import Project

    Project.objects.filter(pk=project.pk).update(claim_limit=2)
    created = client.post(
        "/internal/v1/claim-limit",
        data={"project_slug": project.slug, "requested_limit": 9, "reason": "more"},
        content_type="application/json",
        **INTERNAL_AUTH,
    ).json()

    resolved = client.post(
        f"/api/v1/claim-limit-requests/{created['request_id']}/resolve/",
        data={"approve": False, "note": "One at a time on purpose."},
        content_type="application/json",
        **AUTH,
    )
    assert resolved.status_code == 200, resolved.content
    assert resolved.json()["status"] == "DISMISSED"
    assert Project.objects.get(pk=project.pk).claim_limit == 2


def test_the_same_pending_request_is_not_duplicated(client, project):
    body = {"project_slug": project.slug, "requested_limit": 8, "reason": "first"}
    first = client.post(
        "/internal/v1/claim-limit",
        data=body,
        content_type="application/json",
        **INTERNAL_AUTH,
    ).json()
    second = client.post(
        "/internal/v1/claim-limit",
        data=body,
        content_type="application/json",
        **INTERNAL_AUTH,
    ).json()
    assert first["request_id"] == second["request_id"]


def test_project_patch_validates_the_claim_limit(client, project):
    ok = client.patch(
        f"/api/v1/projects/{project.slug}/",
        data={"claim_limit": 0},
        content_type="application/json",
        **AUTH,
    )
    assert ok.status_code == 200, ok.content
    assert ok.json()["claim_limit"] == 0
    assert ok.json()["claim_slots_used"] == 0

    bad = client.patch(
        f"/api/v1/projects/{project.slug}/",
        data={"claim_limit": 999},
        content_type="application/json",
        **AUTH,
    )
    assert bad.status_code == 400


# ---------------------------------------------------------------------------
# 3. IN_REVIEW requires progress evidence and a complete DoD
# ---------------------------------------------------------------------------
def test_submit_without_progress_is_refused(project, task):
    from core.errors import ReviewPreconditionFailed
    from core.services import tasks as svc
    from tests.conftest import complete_dod

    _claim(project)
    complete_dod(task, agent="Agent-X")

    with pytest.raises(ReviewPreconditionFailed) as raised:
        svc.submit_for_review(
            task_id=task.pk,
            summary_of_work="done",
            git_patch="--- a\n+++ b\n",
            agent_identifier="Agent-X",
        )
    assert raised.value.code == "REVIEW_PRECONDITION_FAILED"
    assert raised.value.detail["field"] == "progress"


def test_submit_with_an_incomplete_dod_is_refused(project, task):
    from core.errors import ReviewPreconditionFailed
    from core.services import tasks as svc

    _claim(project)
    svc.log_progress(task_id=task.pk, message="started", agent_identifier="Agent-X")
    svc.update_dod_item(
        task_id=task.pk, item_id=1, completed=True, agent_identifier="Agent-X"
    )

    with pytest.raises(ReviewPreconditionFailed) as raised:
        svc.submit_for_review(
            task_id=task.pk,
            summary_of_work="done",
            git_patch="--- a\n+++ b\n",
            agent_identifier="Agent-X",
        )
    assert raised.value.detail["field"] == "definition_of_done"
    assert raised.value.detail["dod_progress_percent"] == 33


def test_submit_succeeds_once_both_preconditions_hold(project, task):
    from tests.conftest import drive_to_review

    _claim(project)
    submitted = drive_to_review(task, agent="Agent-X")
    assert submitted.status == TaskStatus.IN_REVIEW
    assert submitted.dod_progress_percent == 100


# ---------------------------------------------------------------------------
# 4. archive from any status; restore resets progress
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "status",
    ["PENDING", "IN_PROGRESS", "IN_REVIEW", "COMPLETED", "REJECTED"],
)
def test_any_status_can_be_archived(client, project, task, status):
    from core.models import Task

    Task.objects.filter(pk=task.pk).update(status=status)
    response = client.post(
        f"/api/v1/tasks/{task.pk}/archive/",
        data={"archived": True},
        content_type="application/json",
        **AUTH,
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "REJECTED"
    assert body["archived_at"] is not None


def test_restore_resets_progress_and_returns_to_pending(client, project, task):
    from core.models import Task
    from tests.conftest import complete_dod

    _claim(project)
    complete_dod(task, agent="Agent-X")
    client.post(
        f"/api/v1/tasks/{task.pk}/archive/",
        data={"archived": True},
        content_type="application/json",
        **AUTH,
    )

    restored = client.post(
        f"/api/v1/tasks/{task.pk}/archive/",
        data={"archived": False},
        content_type="application/json",
        **AUTH,
    )
    assert restored.status_code == 200, restored.content
    body = restored.json()
    assert body["status"] == "PENDING"
    assert body["archived_at"] is None
    assert body["dod_progress_percent"] == 0

    # Nothing may silently stay ticked after a reset.
    assert Task.objects.get(pk=task.pk).checklist.filter(completed=True).count() == 0


def test_requeue_without_restore_keeps_the_ticks(client, project, task):
    """A reviewer rejection is rework, not a restart — only restore resets."""
    from core.models import Task
    from tests.conftest import complete_dod

    _claim(project)
    complete_dod(task, agent="Agent-X")
    Task.objects.filter(pk=task.pk).update(status=TaskStatus.REJECTED)

    requeued = client.post(f"/api/v1/tasks/{task.pk}/requeue/", **AUTH)
    assert requeued.status_code == 200, requeued.content
    assert requeued.json()["status"] == "PENDING"
    assert requeued.json()["dod_progress_percent"] == 100


# ---------------------------------------------------------------------------
# 5. agent-side task search
# ---------------------------------------------------------------------------
def _search(client, project, **body):
    payload = {"project_slug": project.slug, **body}
    return client.post(
        "/internal/v1/tasks/search",
        data=payload,
        content_type="application/json",
        **INTERNAL_AUTH,
    )


def test_search_filters_by_text_and_status(client, project):
    _new_task(project, "Fix POS terminal receipt printing", priority=90)
    _new_task(project, "Fix POS terminal barcode scanner", priority=80)
    _new_task(project, "Upgrade the invoicing report", priority=70)

    response = _search(client, project, q="POS terminal", status=["PENDING"], limit=10)
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["count"] == 2
    assert body["total_matched"] == 2
    assert all("POS terminal" in row["title"] for row in body["items"])
    # Priority ordering is what a claim would follow next.
    assert body["items"][0]["priority"] == 90


def test_search_treats_wildcards_literally(client, project):
    """A `%` or `_` in the query must not behave like a `LIKE` wildcard."""
    _new_task(project, "Discount is 50% off", priority=50)
    _new_task(project, "Unrelated work", priority=40)

    body = _search(client, project, q="50%").json()
    assert body["count"] == 1
    assert "50%" in body["items"][0]["title"]


def test_search_is_word_based_not_phrase_based(client, project):
    _new_task(project, "Terminal POS receipt fix", priority=60)
    body = _search(client, project, q="POS terminal").json()
    assert body["count"] == 1


def test_search_respects_the_limit_and_signals_truncation(client, project):
    for index in range(5):
        _new_task(project, f"POS terminal item {index}")

    body = _search(client, project, q="POS terminal", limit=2).json()
    assert body["count"] == 2
    assert body["total_matched"] == 5
    assert body["truncated"] is True


def test_search_rejects_an_unknown_status(client, project):
    response = _search(client, project, status=["NOPE"])
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_search_never_returns_archived_tasks(client, project, task):
    from core.services.tasks import archive_task

    archive_task(task_id=task.pk)
    body = _search(client, project, q="JWT").json()
    assert body["count"] == 0


def test_search_filters_by_priority_range(client, project):
    _new_task(project, "Low", priority=10)
    _new_task(project, "High", priority=95)

    body = _search(client, project, priority_min=90).json()
    assert [row["priority"] for row in body["items"]] == [95]


# ---------------------------------------------------------------------------
# 6. thumbnails
# ---------------------------------------------------------------------------
def test_uploaded_image_gets_a_thumbnail(client, project, task):
    from core.models import Asset

    response = client.post(
        "/api/v1/assets/",
        data={
            "task_id": str(task.pk),
            "kind": "INPUT_SCREENSHOT",
            "file": io.BytesIO(_png_bytes()),
        },
        format="multipart",
        **AUTH,
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["thumbnail_url"].endswith("/thumbnail")

    asset = Asset.objects.get(pk=body["id"])
    assert asset.thumbnail_relative_path
    # The thumbnail is a separate file, smaller than the original.
    from core.paths import to_absolute_native

    thumb = to_absolute_native(asset.thumbnail_relative_path)
    from pathlib import Path

    assert Path(thumb).is_file()
    assert Path(thumb).stat().st_size < asset.byte_size


def test_thumbnail_route_serves_an_image(client, project, task):
    upload = client.post(
        "/api/v1/assets/",
        data={
            "task_id": str(task.pk),
            "kind": "INPUT_SCREENSHOT",
            "file": io.BytesIO(_png_bytes(1200, 900)),
        },
        format="multipart",
        **AUTH,
    ).json()

    response = client.get(f"/api/v1/assets/{upload['id']}/thumbnail", **AUTH)
    assert response.status_code == 200
    assert response["Content-Type"].startswith("image/")


def test_board_previews_expose_the_thumbnail_url(client, project, task):
    client.post(
        "/api/v1/assets/",
        data={
            "task_id": str(task.pk),
            "kind": "INPUT_SCREENSHOT",
            "file": io.BytesIO(_png_bytes()),
        },
        format="multipart",
        **AUTH,
    )
    previews = client.get(f"/api/v1/projects/{project.slug}/assets/", **AUTH).json()
    images = previews["items"][0]["images"]
    assert images[0]["thumbnail_url"].endswith("/thumbnail")


def test_deleting_an_asset_removes_its_thumbnail(client, project, task):
    from pathlib import Path

    from core.models import Asset
    from core.paths import to_absolute_native

    upload = client.post(
        "/api/v1/assets/",
        data={
            "task_id": str(task.pk),
            "kind": "INPUT_SCREENSHOT",
            "file": io.BytesIO(_png_bytes()),
        },
        format="multipart",
        **AUTH,
    ).json()
    thumb = to_absolute_native(Asset.objects.get(pk=upload["id"]).thumbnail_relative_path)
    assert Path(thumb).is_file()

    removed = client.delete(f"/api/v1/assets/{upload['id']}/", **AUTH)
    assert removed.status_code == 204
    assert not Path(thumb).exists()
