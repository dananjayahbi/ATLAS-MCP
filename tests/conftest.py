"""Pytest bootstrap: point storage at a temp dir and keep tokens deterministic."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP_ROOT = Path(tempfile.mkdtemp(prefix="atlas-test-"))
os.environ.setdefault("ATLAS_STORAGE_ROOT", str(_TMP_ROOT / "storage"))
os.environ.setdefault("ATLAS_API_TOKEN", "test-token")
os.environ.setdefault("ATLAS_DISABLE_SWEEPER", "1")
os.environ.setdefault("ATLAS_SKIP_RECOVERY", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "atlas.settings.dev")


@pytest.fixture(autouse=True)
def _fixed_token(settings):
    """Pin the API token for every test.

    `pytest-django` configures Django before `conftest.py` runs, so the env var
    set at module scope lands too late for `settings.ATLAS_API_TOKEN`.
    """
    settings.ATLAS_API_TOKEN = "test-token"


@pytest.fixture
def project(db, tmp_path, settings):
    """A project whose storage root is isolated per test."""
    root = tmp_path / "storage"
    root.mkdir(parents=True, exist_ok=True)
    settings.ATLAS_STORAGE_ROOT = root

    from core.services.projects import create_project

    return create_project(
        slug="alpha",
        name="Alpha Backend",
        local_repo_path=r"E:\dev\alpha",
        global_rules_md="Use pnpm. Tests: pytest -q.",
    )


@pytest.fixture
def task(db, project):
    from core.services.tasks import create_task

    return create_task(
        project_slug=project.slug,
        title="Fix JWT expiry race condition",
        description="Two concurrent refreshes mint colliding tokens.",
        priority=95,
        dod_items=["Repro test written", "Mutex guard added", "Migrations added"],
    )


def complete_dod(task, *, agent: str = "Agent-Test") -> None:
    """Tick every checklist item, as an agent genuinely finishing the work would."""
    from core.models import ChecklistItem
    from core.services import tasks as svc

    for item in ChecklistItem.objects.filter(task=task).order_by("order_index"):
        svc.update_dod_item(
            task_id=task.pk,
            item_id=item.order_index,
            completed=True,
            agent_identifier=agent,
        )


def drive_to_review(task, *, agent: str = "Agent-Test", patch: str = "--- a\n+++ b\n"):
    """Take a claimed task all the way to `IN_REVIEW` through the real guards.

    `submit_for_review` now requires both a progress log entry and a 100% DoD,
    so every test that only cares about the *review* side still has to satisfy
    those two preconditions here rather than bypassing the transition.
    """
    from core.services import tasks as svc

    svc.log_progress(task_id=task.pk, message="working", agent_identifier=agent)
    complete_dod(task, agent=agent)
    return svc.submit_for_review(
        task_id=task.pk,
        summary_of_work="done",
        git_patch=patch,
        verification_log="1 passed",
        agent_identifier=agent,
    )

