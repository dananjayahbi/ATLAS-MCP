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
