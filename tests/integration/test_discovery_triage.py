"""Discovery triage round-trip and reopening completed work.

Every case here exists because a real button misbehaved: `DISMISS` looked saved
but was never sent (a deferred request the operator could outlive), the edit
modal only exposed priority, an agent's screenshots did not match a manual
upload, and `COMPLETED` was a dead end after a misclick.
"""

from __future__ import annotations

import json
import struct
import zlib

import pytest
from django.test import Client

from core import leases

pytestmark = pytest.mark.django_db

AUTH = {"HTTP_AUTHORIZATION": "Bearer " + "test-token"}


@pytest.fixture(autouse=True)
def _reset_throttles():
    """Throttle buckets are process-global, so a neighbour's uploads would leak in."""
    from api.common.throttle import throttles

    for throttle in throttles.values():
        throttle.reset()
    yield
    for throttle in throttles.values():
        throttle.reset()


@pytest.fixture
def client():
    return Client()


def _post(client, path, payload=None):
    return client.post(
        path,
        data=json.dumps(payload) if payload is not None else "",
        content_type="application/json" if payload is not None else "text/plain",
        **AUTH,
    )


def _patch(client, path, payload):
    return client.patch(path, data=json.dumps(payload), content_type="application/json", **AUTH)


def _png(width: int = 8, height: int = 8) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    rows = b"".join(b"\x00" + bytes([30, 120, 200] * width) for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


@pytest.fixture
def discovery(db, task):
    """A proposal raised by an agent during `task`."""
    from core.services.tasks import propose_task

    return propose_task(
        project_slug=task.project.slug,
        title="Add rate limiting to the refresh endpoint",
        description="The refresh route is unthrottled, so a leaked token can be replayed.",
        suggested_priority=70,
        discovered_during_task_id=str(task.pk),
        discovered_by_agent="Agent-Copilot",
        discovery_reason="Found while reading the auth middleware.",
    )


# ---------------------------------------------------------------------------
# persistence: every triage action must actually move the row
# ---------------------------------------------------------------------------
def _ids(payload) -> set[str]:
    return {str(row["task_id"]) for row in payload["items"]}


def test_reject_moves_the_row_out_of_triage(client, discovery):
    """`DISMISS` must persist, not just hide the card client-side."""
    response = _post(client, f"/api/v1/discoveries/{discovery.pk}/reject/", {"reason": None})
    assert response.status_code == 200
    assert response.json()["status"] == "REJECTED"

    # A reload reads the list again; the dismissed row must not be in it.
    listed = client.get("/api/v1/discoveries/", **AUTH).json()
    assert str(discovery.pk) not in _ids(listed)


def test_restore_undoes_a_dismissal(client, discovery):
    _post(client, f"/api/v1/discoveries/{discovery.pk}/reject/", {"reason": None})

    response = _post(client, f"/api/v1/discoveries/{discovery.pk}/restore/")
    assert response.status_code == 200
    assert response.json()["status"] == "PENDING_APPROVAL"

    listed = client.get("/api/v1/discoveries/", **AUTH).json()
    assert str(discovery.pk) in _ids(listed)


def test_restore_refuses_a_task_that_was_never_a_discovery(client, task):
    from core.services.tasks import archive_task

    archive_task(task_id=task.pk)
    response = _post(client, f"/api/v1/discoveries/{task.pk}/restore/")
    assert response.status_code == 409


def test_approve_moves_the_row_to_pending(client, discovery):
    response = _post(client, f"/api/v1/discoveries/{discovery.pk}/approve/", {"priority": 88})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "PENDING"
    assert body["priority"] == 88


# ---------------------------------------------------------------------------
# full-context edit (the modal used to expose only priority)
# ---------------------------------------------------------------------------
def test_patch_updates_the_whole_context(client, discovery):
    response = _patch(
        client,
        f"/api/v1/discoveries/{discovery.pk}/",
        {
            "title": "Throttle the refresh route",
            "description": "Rewritten by the operator before approving.",
            "priority": 91,
            "discovery_reason": "Escalated after the incident review.",
            "dod_items": ["Limiter wired", "Burst test written"],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Throttle the refresh route"
    assert body["description"] == "Rewritten by the operator before approving."
    assert body["priority"] == 91
    assert body["discovery_reason"] == "Escalated after the incident review."
    assert [item["label"] for item in body["definition_of_done"]] == [
        "Limiter wired",
        "Burst test written",
    ]
    # The suggestion is the agent's original claim and must survive the edit, so
    # the card can still show "suggested P70 -> P91".
    assert body["suggested_priority"] == 70


def test_patch_rejects_status_and_unknown_fields(client, discovery):
    response = _patch(client, f"/api/v1/discoveries/{discovery.pk}/", {"status": "PENDING"})
    assert response.status_code == 400
    assert "status" in json.dumps(response.json())


def test_patch_refuses_an_already_triaged_discovery(client, discovery):
    _post(client, f"/api/v1/discoveries/{discovery.pk}/approve/", {"priority": 70})
    response = _patch(client, f"/api/v1/discoveries/{discovery.pk}/", {"title": "Too late"})
    assert response.status_code == 409


def test_patch_validates_the_title_length(client, discovery):
    response = _patch(client, f"/api/v1/discoveries/{discovery.pk}/", {"title": "x" * 201})
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# images: a discovery must accept the same management as a manual task
# ---------------------------------------------------------------------------
def test_operator_can_upload_an_image_to_a_discovery(client, discovery):
    upload = _png()
    response = client.post(
        "/api/v1/assets/",
        data={"task_id": str(discovery.pk), "kind": "INPUT_SCREENSHOT", "file": _file(upload)},
        **AUTH,
    )
    assert response.status_code == 201
    asset_id = response.json()["id"]

    listed = client.get("/api/v1/discoveries/", **AUTH).json()["items"]
    row = next(item for item in listed if item["task_id"] == str(discovery.pk))
    assert asset_id in {asset["id"] for asset in row["assets"]}

    removed = client.delete(f"/api/v1/assets/{asset_id}/", **AUTH)
    assert removed.status_code == 204


def test_agent_screenshots_match_a_manual_upload(db, project, task, settings, tmp_path):
    """An agent-proposed task must be indistinguishable from a hand-made one.

    `copy_into_task` contains the source path under the storage root (§14.3), so
    the fixture points the root at the temp dir that holds the "agent" file.
    """
    from core.enums import AssetKind
    from core.paths import storage_root
    from core.services.tasks import propose_task

    shot = storage_root() / "agent-shot.png"
    shot.write_bytes(_png())
    proposed = propose_task(
        project_slug=project.slug,
        title="Tighten the CSP header",
        description="script-src still allows unsafe-inline.",
        suggested_priority=60,
        discovered_during_task_id=str(task.pk),
        discovered_by_agent="Agent-Copilot",
        screenshot_paths=[str(shot)],
    )

    asset = proposed.assets.get()
    # Same subdir + kind as `AssetUploadView`, or the two look different on every
    # image surface (board thumbnails, the task editor, the markup modal).
    assert asset.kind == AssetKind.INPUT_SCREENSHOT
    assert asset.mime_type == "image/png"
    assert "/input/" in asset.relative_path


def test_archived_discoveries_do_not_reappear_in_triage(client, discovery):
    """Archive is `REJECTED + archived_at`; triage must ignore the stamp."""
    from core.ids import utcnow
    from core.models import Task

    _post(client, f"/api/v1/discoveries/{discovery.pk}/reject/", {"reason": None})
    Task.objects.filter(pk=discovery.pk).update(archived_at=utcnow())

    listed = client.get("/api/v1/discoveries/", **AUTH).json()
    assert str(discovery.pk) not in _ids(listed)


# ---------------------------------------------------------------------------
# reopening completed work (task 05)
# ---------------------------------------------------------------------------
def _completed(client, task) -> None:
    """Drive `task` to COMPLETED through the real transitions."""
    from tests.conftest import drive_to_review

    leases.claim_specific_task(task_id=str(task.pk), agent_identifier="Agent-Test")
    drive_to_review(task, agent="Agent-Test", patch="--- a\n+++ b\n")
    response = _post(client, f"/api/v1/reviews/{task.pk}/approve/")
    assert response.status_code == 200
    assert response.json()["status"] == "COMPLETED"


@pytest.mark.parametrize(
    ("target", "expected"),
    [
        ("PENDING", "PENDING"),
        ("REJECTED", "REJECTED"),
        ("IN_REVIEW", "IN_REVIEW"),
    ],
)
def test_completed_can_be_reopened(client, task, target, expected):
    _completed(client, task)

    response = client.patch(
        f"/api/v1/tasks/{task.pk}/status/",
        data=json.dumps({"status": target, "note": "Reopened by operator."}),
        content_type="application/json",
        **AUTH,
    )
    assert response.status_code == 200
    assert response.json()["status"] == expected


def test_reopened_task_is_claimable_again(client, task):
    """The lease from the completed run must not survive a reopen to PENDING."""
    _completed(client, task)
    client.patch(
        f"/api/v1/tasks/{task.pk}/status/",
        data=json.dumps({"status": "PENDING"}),
        content_type="application/json",
        **AUTH,
    )
    task.refresh_from_db()
    assert task.claimed_at is None
    assert task.lease_id is None
    assert task.lease_expires_at is None

    claimed = leases.claim_specific_task(task_id=str(task.pk), agent_identifier="Agent-Second")
    assert claimed.task.status == "IN_PROGRESS"


def test_completed_cannot_be_forced_into_in_progress(client, task):
    """Only an agent may claim work; a human cannot shortcut the lease."""
    _completed(client, task)

    response = client.patch(
        f"/api/v1/tasks/{task.pk}/status/",
        data=json.dumps({"status": "IN_PROGRESS"}),
        content_type="application/json",
        **AUTH,
    )
    assert response.status_code == 409


def test_reopening_to_rejected_lands_in_the_live_rejected_column(client, task):
    """Rejected-after-completion is a live row, not an archived one.

    Archiving is a separate deliberate action (T12). If reopening stamped
    `archived_at`, the row would vanish from the board column the operator sent
    it to *and* stay unclaimable if they changed their mind again.
    """
    _completed(client, task)
    client.patch(
        f"/api/v1/tasks/{task.pk}/status/",
        data=json.dumps({"status": "REJECTED"}),
        content_type="application/json",
        **AUTH,
    )
    task.refresh_from_db()
    assert task.status == "REJECTED"
    assert task.archived_at is None


def test_reopening_a_task_that_was_archived_clears_the_stamp(client, task):
    """A completion can only be reopened; the archive stamp must not survive."""
    from core.ids import utcnow
    from core.models import Task

    _completed(client, task)
    Task.objects.filter(pk=task.pk).update(archived_at=utcnow())

    client.patch(
        f"/api/v1/tasks/{task.pk}/status/",
        data=json.dumps({"status": "PENDING"}),
        content_type="application/json",
        **AUTH,
    )
    task.refresh_from_db()
    assert task.archived_at is None


def _file(payload: bytes, name: str = "shot.png"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, payload, content_type="image/png")
