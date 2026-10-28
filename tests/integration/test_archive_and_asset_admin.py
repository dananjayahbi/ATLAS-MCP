"""Archive/restore/purge routes and per-asset management (HUD polish).

Archive is the reversible removal the board needs: an operator files work away
and the row stops appearing on every working surface without the evidence being
destroyed. Purge and per-asset delete are the irreversible counterparts, so each
one is guarded — a typed confirmation for projects, an evidence fence for tasks.
"""

from __future__ import annotations

import json
import struct
import zlib

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db

AUTH = {"HTTP_AUTHORIZATION": "Bearer " + "test-token"}


@pytest.fixture
def client():
    return Client()


@pytest.fixture(autouse=True)
def _reset_throttles():
    """Throttle buckets are process-global, so a neighbour's uploads would leak in."""
    from api.common.throttle import throttles

    for throttle in throttles.values():
        throttle.reset()
    yield
    for throttle in throttles.values():
        throttle.reset()


def _get(client, path, **extra):
    return client.get(path, **{**AUTH, **extra})


def _post(client, path, payload=None):
    return client.post(
        path,
        data=json.dumps(payload) if payload is not None else "",
        content_type="application/json" if payload is not None else "text/plain",
        **AUTH,
    )


def _delete(client, path, **extra):
    return client.delete(path, **{**AUTH, **extra})


def _png(width: int = 8, height: int = 8, tint: int = 200) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    rows = b"".join(b"\x00" + bytes([tint, 40, 90] * width) for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def _upload(client, task, name="shot.png", tint=200) -> dict:
    from django.core.files.uploadedfile import SimpleUploadedFile

    upload = SimpleUploadedFile(name, _png(tint=tint), content_type="image/png")
    response = client.post(
        "/api/v1/assets/",
        data={"task_id": str(task.pk), "kind": "INPUT_SCREENSHOT", "file": upload},
        **AUTH,
    )
    assert response.status_code == 201, response.content
    return response.json()


def _titles(client, path) -> set[str]:
    response = _get(client, path)
    assert response.status_code == 200, response.content
    return {item["title"] for item in response.json()["items"]}


def _patch_status(client, task, status: str):
    response = client.patch(
        f"/api/v1/tasks/{task.pk}/status/",
        data=json.dumps({"status": status}),
        content_type="application/json",
        **AUTH,
    )
    assert response.status_code == 200, response.content
    return response


# ---------------------------------------------------------------------------
# task archive / restore
# ---------------------------------------------------------------------------
def test_archived_task_leaves_the_board_and_returns_on_restore(client, project, task):
    board = f"/api/v1/projects/{project.slug}/tasks/"
    assert task.title in _titles(client, board)

    archived = _post(client, f"/api/v1/tasks/{task.pk}/archive/", {"archived": True})
    assert archived.status_code == 200, archived.content
    assert archived.json()["archived_at"] is not None

    assert task.title not in _titles(client, board)
    assert task.title in _titles(client, f"{board}?archived=1")

    restored = _post(client, f"/api/v1/tasks/{task.pk}/archive/", {"archived": False})
    assert restored.status_code == 200, restored.content
    assert restored.json()["archived_at"] is None
    assert restored.json()["status"] == "PENDING"
    assert task.title in _titles(client, board)


def test_archive_defaults_to_archiving_when_the_flag_is_omitted(client, task):
    response = _post(client, f"/api/v1/tasks/{task.pk}/archive/", {})
    assert response.status_code == 200, response.content
    assert response.json()["archived_at"] is not None


def test_archive_rejects_a_non_boolean_flag(client, task):
    response = _post(client, f"/api/v1/tasks/{task.pk}/archive/", {"archived": "yes"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_restoring_a_task_that_is_not_archived_is_a_conflict(client, task):
    response = _post(client, f"/api/v1/tasks/{task.pk}/archive/", {"archived": False})
    assert response.status_code == 409


def test_archiving_live_work_is_refused(client, task):
    """Only queued or rejected work can be filed away — never live work."""
    _patch_status(client, task, "IN_PROGRESS")

    response = _post(client, f"/api/v1/tasks/{task.pk}/archive/", {"archived": True})
    assert response.status_code == 409

    from core.models import Task

    assert Task.objects.get(pk=task.pk).archived_at is None


# ---------------------------------------------------------------------------
# project archive filter + purge
# ---------------------------------------------------------------------------
def test_project_list_hides_archived_projects_by_default(client, project):
    _post(client, f"/api/v1/projects/{project.slug}/archive/", {"archived": True})

    assert _get(client, "/api/v1/projects/").json()["items"] == []
    assert len(_get(client, "/api/v1/projects/?archived=1").json()["items"]) == 1
    assert len(_get(client, "/api/v1/projects/?archived=0").json()["items"]) == 0
    assert len(_get(client, "/api/v1/projects/?archived=all").json()["items"]) == 1


def test_delete_without_confirmation_still_archives(client, project):
    response = _delete(client, f"/api/v1/projects/{project.slug}/")
    assert response.status_code == 200, response.content
    assert response.json()["archived_at"] is not None


def test_delete_with_the_slug_echoed_purges_rows_and_storage(client, project, task):
    from core.models import Asset, Project, Task
    from core.storage import router

    _upload(client, task)
    project_dir = router.project_dir(project.pk)
    assert project_dir.exists()

    response = _delete(client, f"/api/v1/projects/{project.slug}/?confirm={project.slug}")
    assert response.status_code == 204, response.content

    assert not Project.objects.filter(pk=project.pk).exists()
    assert not Task.objects.filter(pk=task.pk).exists()
    assert not Asset.objects.filter(task_id=task.pk).exists()
    assert not project_dir.exists()


def test_purge_requires_an_exact_confirmation(client, project):
    response = _delete(client, f"/api/v1/projects/{project.slug}/?confirm=alph")
    assert response.status_code == 200
    from core.models import Project

    assert Project.objects.filter(pk=project.pk).exists()


# ---------------------------------------------------------------------------
# per-task image listing + delete
# ---------------------------------------------------------------------------
def test_previews_can_be_scoped_to_one_task_without_the_board_cap(client, project, task):
    from api.v1.views.assets import PREVIEWS_PER_TASK

    for index in range(PREVIEWS_PER_TASK + 2):
        _upload(client, task, name=f"shot{index}.png")

    scoped = _get(client, f"/api/v1/projects/{project.slug}/assets/?task_id={task.pk}")
    assert scoped.status_code == 200, scoped.content
    images = scoped.json()["items"][0]["images"]
    assert len(images) == PREVIEWS_PER_TASK + 2
    assert {"byte_size", "created_at"} <= set(images[0])


def test_asset_delete_removes_the_row_and_the_bytes(client, task):
    from core.models import Asset
    from core.paths import resolve_under

    created = _upload(client, task)
    stored = resolve_under(Asset.objects.get(pk=created["id"]).relative_path)
    assert stored.exists()

    response = _delete(client, f"/api/v1/assets/{created['id']}/")
    assert response.status_code == 204, response.content
    assert not Asset.objects.filter(pk=created["id"]).exists()
    assert not stored.exists()
    assert _get(client, f"/api/v1/assets/{created['id']}/content").status_code == 404


# ---------------------------------------------------------------------------
# markup burn-in modes
# ---------------------------------------------------------------------------
DOCUMENT = {
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


def _annotate(client, asset_id, **fields):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return client.post(
        f"/api/v1/assets/{asset_id}/annotation/",
        data={
            "file": SimpleUploadedFile("annotated.png", _png(tint=10), content_type="image/png"),
            "document": json.dumps(DOCUMENT),
            **fields,
        },
        **AUTH,
    )


def test_replace_only_leaves_exactly_one_edited_image(client, task):
    from core.models import Asset
    from core.paths import resolve_under

    source = _upload(client, task, tint=200)
    stored = resolve_under(Asset.objects.get(pk=source["id"]).relative_path)
    original_sha = Asset.objects.get(pk=source["id"]).sha256

    response = _annotate(client, source["id"], replace_only="1")
    assert response.status_code == 200, response.content
    payload = response.json()
    assert payload["replaced_source"] is True
    assert payload["asset"]["id"] == source["id"]

    # No duplicate asset, no orphan PNG: the burn-in *is* the image now.
    assert not Asset.objects.filter(
        task=task, kind="ANNOTATED_CANVAS"
    ).exists()
    refreshed = Asset.objects.get(pk=source["id"])
    assert refreshed.sha256 != original_sha
    assert stored.read_bytes() == _png(tint=10)

    # The strokes are pixels now, so the editable document is gone: replaying it
    # over the burned bitmap would double-darken the markup on reopen.
    read = _get(client, f"/api/v1/assets/{source['id']}/annotation/")
    assert read.json()["document"] is None


def test_default_annotation_keeps_the_append_only_duplicate(client, task):
    from core.models import Asset

    source = _upload(client, task)
    response = _annotate(client, source["id"], replace_source="1")
    assert response.status_code == 201, response.content
    assert response.json()["asset"]["kind"] == "ANNOTATED_CANVAS"
    assert Asset.objects.filter(task=task, kind="ANNOTATED_CANVAS").count() == 1


def test_two_images_with_the_same_filename_keep_separate_documents(client, task):
    """The reported "markup appears on every image": documents were per filename."""
    from django.core.files.uploadedfile import SimpleUploadedFile

    first = _upload(client, task, name="shot.png", tint=200)
    second = _upload(client, task, name="shot.png", tint=90)
    assert first["id"] != second["id"]

    first_doc = {
        "version": 1,
        "strokes": [
            {"id": "a", "tool": "pen", "color": "#FF0000", "width": 4, "points": [{"x": 0, "y": 0}]}
        ],
    }
    saved = client.post(
        f"/api/v1/assets/{first['id']}/annotation/",
        data={
            "file": SimpleUploadedFile("a.png", _png(tint=10), content_type="image/png"),
            "document": json.dumps(first_doc),
            "replace_source": "1",
        },
        **AUTH,
    )
    assert saved.status_code == 201, saved.content

    # The sibling image must still read as untouched.
    sibling = _get(client, f"/api/v1/assets/{second['id']}/annotation/")
    assert sibling.status_code == 200
    assert sibling.json()["document"] is None
    assert _get(client, f"/api/v1/assets/{first['id']}/annotation/").json()["document"] == first_doc


def test_burn_in_changes_the_asset_version_so_caches_miss(client, task):
    """A stable URL with new bytes would keep rendering the pre-markup image."""
    from core.models import Asset

    source = _upload(client, task)
    before = _get(client, f"/api/v1/assets/{source['id']}/")
    assert before.status_code == 200
    assert before.json()["version"] == Asset.objects.get(pk=source["id"]).sha256

    annotated = _annotate(client, source["id"], replace_only="1")
    after = _get(client, f"/api/v1/assets/{source['id']}/")
    assert after.json()["version"] != before.json()["version"]
    assert after.json()["version"] == annotated.json()["asset"]["version"]


def test_asset_content_serves_an_etag_and_honours_it(client, task):
    from core.models import Asset

    source = _upload(client, task)
    digest = Asset.objects.get(pk=source["id"]).sha256

    first = _get(client, f"/api/v1/assets/{source['id']}/content")
    assert first.status_code == 200
    assert first["ETag"] == f'"{digest}"'
    # `no-cache` means "revalidate", not "don't store": the sha decides freshness.
    assert "no-cache" in first["Cache-Control"]

    revalidated = _get(
        client,
        f"/api/v1/assets/{source['id']}/content",
        HTTP_IF_NONE_MATCH=f'"{digest}"',
    )
    assert revalidated.status_code == 304


def test_previews_carry_the_version_for_every_thumbnail(client, project, task):
    from core.models import Asset

    _upload(client, task)
    images = _get(client, f"/api/v1/projects/{project.slug}/assets/").json()["items"][0]["images"]
    assert images[0]["version"] == Asset.objects.get(pk=images[0]["id"]).sha256


def test_deleting_an_image_removes_its_stroke_document(client, task):
    from core.models import Asset
    from core.storage import router

    source = _upload(client, task)
    # A non-destructive save keeps the strokes editable, which is what the
    # side-car cleanup below has to cover.
    _annotate(client, source["id"], replace_source="1")
    asset = Asset.objects.get(pk=source["id"])
    directory = router.task_input_dir(asset.task.project_id, asset.task_id)
    assert (directory / f"canvas_{source['id']}.json").is_file()

    assert _delete(client, f"/api/v1/assets/{source['id']}/").status_code == 204
    assert not (directory / f"canvas_{source['id']}.json").exists()
