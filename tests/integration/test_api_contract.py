"""REST API contract tests (Doc 01 §7, §8, §15)."""

from __future__ import annotations

import json

import pytest
from django.test import Client

pytestmark = pytest.mark.django_db

TOKEN = "test-token"
AUTH = {"HTTP_AUTHORIZATION": f"Bearer {TOKEN}"}


@pytest.fixture
def client():
    return Client()


def _get(client, path, **extra):
    return client.get(path, **{**AUTH, **extra})


def _post(client, path, payload=None, **extra):
    return client.post(
        path,
        data=json.dumps(payload) if payload is not None else "",
        content_type="application/json" if payload is not None else "text/plain",
        **{**AUTH, **extra},
    )


def _patch(client, path, payload):
    return client.patch(
        path, data=json.dumps(payload), content_type="application/json", **AUTH
    )


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------
def test_missing_token_returns_envelope(client, project):
    response = client.get("/api/v1/projects/")
    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "AUTH_MISSING"
    assert set(body["error"]) == {"code", "message", "retryable", "detail", "request_id"}


def test_healthz_is_public(client, project):
    response = client.get("/healthz")
    assert response.status_code in (200, 503)
    assert "db" in response.json()


# ---------------------------------------------------------------------------
# throttling (Doc 04 §3.4, Doc 06 §11.4)
# ---------------------------------------------------------------------------
def test_throttle_rejection_is_429_with_retry_after(client, project, settings):
    """A burst must surface as `RATE_LIMITED`/429, never INTERNAL_ERROR/500.

    Doc 06 §11.4 retries `RATE_LIMITED` once after `Retry-After`; a 500 would
    instead select the `INTERNAL_ERROR` path and read as a backend fault.
    """
    from api.common.throttle import throttles

    throttle = throttles["read"]
    throttle.reset()
    try:
        for _ in range(throttle.limit):
            assert _get(client, "/api/v1/projects/").status_code == 200

        response = _get(client, "/api/v1/projects/")
        assert response.status_code == 429
        body = response.json()
        assert body["error"]["code"] == "RATE_LIMITED"
        assert body["error"]["retryable"] is True
        assert body["error"]["detail"]["limit"] == throttle.limit
        assert int(response["Retry-After"]) >= 1
    finally:
        throttle.reset()


def test_mutations_are_not_throttled(client, project, task):
    """Doc 04 §3.4 budgets `/api/v1` **GETs**; a bulk action must not starve."""
    from api.common.throttle import throttles

    throttle = throttles["read"]
    throttle.reset()
    original = throttle.limit
    throttle.limit = 1
    try:
        assert _get(client, "/api/v1/projects/").status_code == 200
        assert _get(client, "/api/v1/projects/").status_code == 429

        response = _patch(client, f"/api/v1/tasks/{task.pk}/", {"priority": 40})
        assert response.status_code == 200
        assert response.json()["priority"] == 40
    finally:
        throttle.limit = original
        throttle.reset()


# ---------------------------------------------------------------------------
# projects
# ---------------------------------------------------------------------------
def test_list_projects_matches_dto(client, project):
    response = _get(client, "/api/v1/projects/")
    assert response.status_code == 200
    items = response.json()["items"]
    assert items[0]["slug"] == "alpha"
    assert set(items[0]["counters"]) == {
        "pending",
        "in_progress",
        "in_review",
        "completed",
        "pending_approval",
        "health_percent",
    }


def test_create_project_conflict(client, project):
    response = _post(
        client,
        "/api/v1/projects/",
        {"slug": "alpha", "name": "Dup", "local_repo_path": "E:\\x"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# tasks
# ---------------------------------------------------------------------------
def test_task_detail_dto_shape(client, task):
    response = _get(client, f"/api/v1/tasks/{task.pk}/")
    assert response.status_code == 200
    body = response.json()
    for key in (
        "id",
        "project_slug",
        "title",
        "status",
        "priority",
        "dod_progress_percent",
        "is_blocked",
        "definition_of_done",
        "assets",
        "recent_events",
        "attempt_count",
    ):
        assert key in body, key
    assert body["definition_of_done"][0]["id"] == 1


def test_priority_patch(client, task):
    response = _patch(client, f"/api/v1/tasks/{task.pk}/priority/", {"priority": 42})
    assert response.status_code == 200
    assert response.json()["priority"] == 42


def test_priority_out_of_range(client, task):
    response = _patch(client, f"/api/v1/tasks/{task.pk}/priority/", {"priority": 900})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_dod_toggle(client, task):
    response = _patch(
        client, f"/api/v1/tasks/{task.pk}/dod/1/", {"completed": True}
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "dod_progress_percent": 33}

def test_bodiless_force_release_is_not_400(client, task):
    from core import leases

    leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    response = client.post(f"/api/v1/tasks/{task.pk}/force-release/", **AUTH)
    assert response.status_code == 200, response.content
    assert response.json()["status"] == "PENDING"


def test_requeue_from_pending_is_conflict(client, task):
    response = _post(client, f"/api/v1/tasks/{task.pk}/requeue/")
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "INVALID_TRANSITION"
    assert body["detail"]["action"] == "requeue_task"


def test_claim_for_agent_twice_emits_already_leased(client, task):
    first = _post(
        client,
        f"/api/v1/tasks/{task.pk}/claim-for-agent/",
        {"agent_identifier": "Agent-Claude"},
    )
    assert first.status_code == 200
    second = _post(
        client,
        f"/api/v1/tasks/{task.pk}/claim-for-agent/",
        {"agent_identifier": "Agent-Other"},
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "TASK_ALREADY_LEASED"


# ---------------------------------------------------------------------------
# discoveries & reviews
# ---------------------------------------------------------------------------
def test_discovery_approve_flow(client, project, task):
    from core.services import tasks as svc

    discovery = svc.propose_task(
        project_slug="alpha",
        title="Migrate auth middleware",
        description="Deprecated API",
        suggested_priority=85,
        discovered_during_task_id=str(task.pk),
        discovered_by_agent="Agent-Claude",
    )

    listing = _get(client, "/api/v1/discoveries/")
    assert listing.json()["items"][0]["task_id"] == str(discovery.pk)
    assert listing.json()["items"][0]["assets"] == []

    approved = _post(client, f"/api/v1/discoveries/{discovery.pk}/approve/")
    assert approved.status_code == 200
    assert approved.json()["status"] == "PENDING"
    assert approved.json()["priority"] == 85


def test_review_approve_accepts_no_body(client, project, task):
    from core import leases
    from tests.conftest import drive_to_review

    leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    drive_to_review(task, agent="Agent-X")
    response = client.post(f"/api/v1/reviews/{task.pk}/approve/", **AUTH)
    assert response.status_code == 200, response.content
    assert response.json()["status"] == "COMPLETED"


# ---------------------------------------------------------------------------
# telemetry
# ---------------------------------------------------------------------------
def test_telemetry_summary(client, project, task):
    body = _get(client, "/api/v1/telemetry/summary").json()
    assert body["tasks_by_status"]["PENDING"] == 1
    assert body["projects"][0]["slug"] == "alpha"
    assert body["generated_at"].endswith("Z")


def test_priority_matrix(client, project, task):
    body = _get(client, "/api/v1/priority-matrix?x=dependency_weight").json()
    assert body["axes"]["x"] == "dependency_weight"
    assert body["points"][0]["task_id"] == str(task.pk)


# ---------------------------------------------------------------------------
# internal RPC
# ---------------------------------------------------------------------------
def test_internal_claim_requires_agent_header(client, project, task):
    response = client.post(
        "/internal/v1/claim",
        data=json.dumps({"project_slug": "alpha", "agent_identifier": "Agent-X"}),
        content_type="application/json",
        **AUTH,
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_MISSING"


def test_internal_claim_projection_is_token_budgeted(client, project, task):
    response = client.post(
        "/internal/v1/claim",
        data=json.dumps(
            {"project_slug": "alpha", "agent_identifier": "Agent-X", "min_priority": 0}
        ),
        content_type="application/json",
        HTTP_X_ATLAS_AGENT="Agent-X",
        **AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["task_id"] == str(task.pk)
    assert len(json.dumps(body).encode()) <= 16_384
    assert "created_at" not in body
    assert body["lease_ttl_seconds"] == 900
    assert body["heartbeat_interval_seconds"] == 120


def test_internal_claim_empty_queue_returns_two_fields(client, project):
    response = client.post(
        "/internal/v1/claim",
        data=json.dumps({"project_slug": "alpha", "agent_identifier": "Agent-X"}),
        content_type="application/json",
        HTTP_X_ATLAS_AGENT="Agent-X",
        **AUTH,
    )
    assert response.status_code == 200
    assert response.json() == {"task_id": None, "reason": "NO_ELIGIBLE_TASK"}


def test_internal_progress_returns_only_ok(client, project, task):
    response = client.post(
        "/internal/v1/progress",
        data=json.dumps({"task_id": str(task.pk), "message": "running tests"}),
        content_type="application/json",
        HTTP_X_ATLAS_AGENT="Agent-X",
        **AUTH,
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_internal_heartbeat_reports_seconds_remaining(client, project, task):
    from core import leases

    claimed = leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    response = client.post(
        "/internal/v1/heartbeat",
        data=json.dumps({"task_id": str(task.pk), "lease_id": claimed.lease_id}),
        content_type="application/json",
        HTTP_X_ATLAS_AGENT="Agent-X",
        **AUTH,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["seconds_remaining"] == 900


def test_stale_lease_heartbeat(client, project, task):
    from core import leases

    leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-X")
    response = client.post(
        "/internal/v1/heartbeat",
        data=json.dumps({"task_id": str(task.pk), "lease_id": "lea_WRONG"}),
        content_type="application/json",
        HTTP_X_ATLAS_AGENT="Agent-X",
        **AUTH,
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "STALE_LEASE"
