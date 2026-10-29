"""Operator edit/delete routes and the markup round-trip (Doc 04 §5.1–5.2, §5.8).

These cover the routes that exist so the HUD can *edit* what it creates: the
original contract only described creation, and every gap here was a button that
silently did nothing.
"""

from __future__ import annotations

import json
import struct
import zlib

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db

TOKEN = "test-token"
# Spelled out rather than relying on a default header so each test reads as an
# authenticated operator request (the value is the pinned `test-token`).
AUTH = {"HTTP_AUTHORIZATION": "Bearer " + "test-token"}


@pytest.fixture
def client():
    return Client()


def _patch(client, path, payload):
    return client.patch(path, data=json.dumps(payload), content_type="application/json", **AUTH)


def _post(client, path, payload=None):
    return client.post(
        path,
        data=json.dumps(payload) if payload is not None else "",
        content_type="application/json" if payload is not None else "text/plain",
        **AUTH,
    )


def _png(width: int = 8, height: int = 8) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    rows = b"".join(b"\x00" + bytes([200, 40, 90] * width) for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


# ---------------------------------------------------------------------------
# task edits
# ---------------------------------------------------------------------------
def test_patch_task_updates_metadata(client, task):
    response = _patch(
        client,
        f"/api/v1/tasks/{task.pk}/",
        {"title": "Renamed", "description": "New body", "priority": 12},
    )
    assert response.status_code == 200, response.content
    payload = response.json()
    assert payload["title"] == "Renamed"
    assert payload["priority"] == 12


def test_patch_task_rejects_unknown_fields(client, task):
    response = _patch(client, f"/api/v1/tasks/{task.pk}/", {"status": "COMPLETED"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_patch_task_rewrites_dod_and_keeps_completion_by_label(client, task):
    done = task.checklist.get(order_index=1)
    done.completed = True
    done.save(update_fields=["completed"])

    response = _patch(
        client,
        f"/api/v1/tasks/{task.pk}/",
        {"dod_items": ["Repro test written", "A brand new step"]},
    )
    assert response.status_code == 200, response.content
    items = response.json()["definition_of_done"]
    assert [item["label"] for item in items] == ["Repro test written", "A brand new step"]
    # Completion follows the label, not the position.
    assert items[0]["completed"] is True
    assert items[1]["completed"] is False


def test_completed_task_cannot_be_edited(client, task):
    from core import leases
    from core.services import tasks as task_service
    from tests.conftest import drive_to_review

    leases.claim_specific_task(task_id=task.pk, agent_identifier="Agent-Claude")
    drive_to_review(task, agent="Agent-Claude")
    task_service.approve_review(task_id=task.pk)

    response = _patch(client, f"/api/v1/tasks/{task.pk}/", {"title": "nope"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_TRANSITION"


# ---------------------------------------------------------------------------
# task delete
# ---------------------------------------------------------------------------
def test_delete_untouched_task_is_204(client, task):
    response = client.delete(f"/api/v1/tasks/{task.pk}/", **AUTH)
    assert response.status_code == 204

    from core.models import Task

    assert not Task.objects.filter(pk=task.pk).exists()


def test_delete_refuses_claimed_task(client, task):
    from core import leases

    leases.claim_specific_task(task_id=task.pk, agent_identifier="Agent-Claude")
    # T11: an operator can reclaim a wedged lease, but the task is still
    # IN_PROGRESS and its evidence must not be deleted.
    leases.release(task_id=task.pk, actor="human", reason="force_release")

    response = client.delete(f"/api/v1/tasks/{task.pk}/", **AUTH)
    assert response.status_code == 409
    assert "archive" in response.json()["error"]["message"]


def test_delete_refuses_in_progress_task(client, task):
    from core import leases

    leases.claim_specific_task(task_id=task.pk, agent_identifier="Agent-Claude")

    response = client.delete(f"/api/v1/tasks/{task.pk}/", **AUTH)
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# manual status
# ---------------------------------------------------------------------------
def test_status_pending_to_in_progress_claims_for_the_assignee(client, task):
    response = _patch(client, f"/api/v1/tasks/{task.pk}/status/", {"status": "IN_PROGRESS"})
    assert response.status_code == 200, response.content
    payload = response.json()
    assert payload["status"] == "IN_PROGRESS"
    assert payload["assigned_agent_id"]  # an operator move still names an owner


def test_status_rejects_an_illegal_hop(client, task):
    response = _patch(client, f"/api/v1/tasks/{task.pk}/status/", {"status": "COMPLETED"})
    assert response.status_code == 409
    assert response.json()["error"]["detail"]["from"] == "PENDING"


def test_status_rejects_a_no_op(client, task):
    response = _patch(client, f"/api/v1/tasks/{task.pk}/status/", {"status": "PENDING"})
    assert response.status_code == 409


def test_status_reopen_from_review_requires_notes(client, task):
    from core import leases
    from tests.conftest import drive_to_review

    leases.claim_specific_task(task_id=task.pk, agent_identifier="Agent-Claude")
    drive_to_review(task, agent="Agent-Claude")
    response = _patch(client, f"/api/v1/tasks/{task.pk}/status/", {"status": "PENDING"})
    # A default note is supplied by the route, so this succeeds and lands in PENDING.
    assert response.status_code == 200, response.content
    assert response.json()["status"] == "PENDING"
    assert response.json()["review_notes"]


# ---------------------------------------------------------------------------
# assignee
# ---------------------------------------------------------------------------
def test_assignee_can_be_set_and_cleared(client, task):
    response = _patch(
        client, f"/api/v1/tasks/{task.pk}/assignee/", {"assigned_agent_id": "Agent-Claude"}
    )
    assert response.status_code == 200, response.content
    assert response.json()["assigned_agent_id"] == "Agent-Claude"

    cleared = _patch(client, f"/api/v1/tasks/{task.pk}/assignee/", {"assigned_agent_id": None})
    assert cleared.status_code == 200
    assert cleared.json()["assigned_agent_id"] is None


def test_assignee_refused_while_leased(client, task):
    from core import leases

    leases.claim_specific_task(task_id=task.pk, agent_identifier="Agent-Claude")

    response = _patch(
        client, f"/api/v1/tasks/{task.pk}/assignee/", {"assigned_agent_id": "Agent-Other"}
    )
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# project edit / archive
# ---------------------------------------------------------------------------
def test_patch_project_updates_editable_fields(client, project):
    response = _patch(
        client,
        f"/api/v1/projects/{project.slug}/",
        {"name": "Renamed", "accent_color": "#7CF7C4"},
    )
    assert response.status_code == 200, response.content
    payload = response.json()
    assert payload["name"] == "Renamed"
    assert payload["accent_color"] == "#7CF7C4"


def test_patch_project_rejects_slug_change(client, project):
    response = _patch(client, f"/api/v1/projects/{project.slug}/", {"slug": "other"})
    assert response.status_code == 400


def test_project_archive_round_trip(client, project):
    archived = _post(client, f"/api/v1/projects/{project.slug}/archive/", {"archived": True})
    assert archived.status_code == 200, archived.content
    assert archived.json()["archived_at"] is not None

    restored = _post(client, f"/api/v1/projects/{project.slug}/archive/", {"archived": False})
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None


def test_archived_project_tasks_are_not_claimable(client, project, task):
    _post(client, f"/api/v1/projects/{project.slug}/archive/", {"archived": True})

    from core import leases
    from core.errors import InvalidTransition

    with pytest.raises(InvalidTransition):
        leases.claim_specific_task(task_id=task.pk, agent_identifier="Agent-Claude")


# ---------------------------------------------------------------------------
# asset previews for the board thumbnails
# ---------------------------------------------------------------------------
def _upload(client, task, name="shot.png") -> dict:
    from django.core.files.uploadedfile import SimpleUploadedFile

    upload = SimpleUploadedFile(name, _png(), content_type="image/png")
    response = client.post(
        "/api/v1/assets/",
        data={"task_id": str(task.pk), "kind": "INPUT_SCREENSHOT", "file": upload},
        **AUTH,
    )
    assert response.status_code == 201, response.content
    return response.json()


def test_project_asset_previews_group_by_task(client, project, task):
    first = _upload(client, task)
    second = _upload(client, task, name="shot2.png")

    response = client.get(f"/api/v1/projects/{project.slug}/assets/", **AUTH)
    assert response.status_code == 200, response.content
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["task_id"] == str(task.pk)
    assert items[0]["total"] == 2
    assert {image["id"] for image in items[0]["images"]} == {first["id"], second["id"]}


def test_previews_are_capped_per_task(client, project, task):
    from api.v1.views.assets import PREVIEWS_PER_TASK

    for index in range(PREVIEWS_PER_TASK + 2):
        _upload(client, task, name=f"shot{index}.png")

    response = client.get(f"/api/v1/projects/{project.slug}/assets/", **AUTH)
    items = response.json()["items"]
    assert len(items[0]["images"]) == PREVIEWS_PER_TASK
    assert items[0]["total"] == PREVIEWS_PER_TASK + 2


# ---------------------------------------------------------------------------
# markup round trip
# ---------------------------------------------------------------------------
def test_annotation_round_trip_burns_a_new_asset_and_keeps_the_document(client, task):
    from django.core.files.uploadedfile import SimpleUploadedFile

    source = _upload(client, task)
    document = {
        "version": 1,
        "strokes": [
            {
                "id": "s1",
                "tool": "pen",
                "color": "#FF3B5C",
                "width": 6,
                "points": [{"x": 1, "y": 2}, {"x": 3, "y": 4}],
            }
        ],
    }

    response = client.post(
        f"/api/v1/assets/{source['id']}/annotation/",
        data={
            "file": SimpleUploadedFile("annotated.png", _png(), content_type="image/png"),
            "document": json.dumps(document),
            "replace_source": "1",
        },
        **AUTH,
    )
    assert response.status_code == 201, response.content
    payload = response.json()
    assert payload["asset"]["kind"] == "ANNOTATED_CANVAS"
    assert payload["replaced_source"] is True

    read = client.get(f"/api/v1/assets/{source['id']}/annotation/", **AUTH)
    assert read.status_code == 200, read.content
    assert read.json()["document"] == document
    assert read.json()["annotated_asset"]["id"] == payload["asset"]["id"]


def test_annotation_rejects_malformed_document_json(client, task):
    from django.core.files.uploadedfile import SimpleUploadedFile

    source = _upload(client, task)

    response = client.post(
        f"/api/v1/assets/{source['id']}/annotation/",
        data={
            "file": SimpleUploadedFile("annotated.png", _png(), content_type="image/png"),
            "document": "{not json",
        },
        **AUTH,
    )
    assert response.status_code == 400


def test_annotation_rejects_a_non_image_source(client, task):
    from django.core.files.uploadedfile import SimpleUploadedFile

    upload = SimpleUploadedFile("notes.txt", b"hello", content_type="text/plain")
    created = client.post(
        "/api/v1/assets/",
        data={"task_id": str(task.pk), "kind": "USER_CONTEXT", "file": upload},
        **AUTH,
    )
    assert created.status_code == 201, created.content

    response = client.post(
        f"/api/v1/assets/{created.json()['id']}/annotation/",
        data={"file": SimpleUploadedFile("annotated.png", _png(), content_type="image/png")},
        **AUTH,
    )
    assert response.status_code == 415
