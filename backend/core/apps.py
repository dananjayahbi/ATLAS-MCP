"""Core app config: boots the recovery watchdog (Doc 03 §6)."""

from __future__ import annotations

import logging
import os
import sys

from django.apps import AppConfig

logger = logging.getLogger("atlas.core")


class CoreConfig(AppConfig):
    name = "core"
    label = "core"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self) -> None:  # pragma: no cover - exercised by boot tests
        if _is_management_command_that_should_not_boot():
            return
        from core import recovery

        recovery.start_background_sweeper()


def _is_management_command_that_should_not_boot() -> bool:
    """Skip recovery for commands that must not touch the DB or spawn threads."""
    argv = " ".join(sys.argv[1:3]).lower()
    quiet = ("makemigrations", "collectstatic", "test", "shell", "migrate --plan")
    if any(cmd in argv for cmd in quiet):
        return True
    return os.environ.get("ATLAS_SKIP_RECOVERY", "") == "1"
