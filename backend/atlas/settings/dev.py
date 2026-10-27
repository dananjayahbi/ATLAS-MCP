"""Development settings: DEBUG on, permissive loopback CORS."""

from __future__ import annotations

import os

from atlas.settings.base import *  # noqa: F401,F403
from atlas.settings.base import env_bool

DEBUG = env_bool("ATLAS_DEBUG", True)
os.environ.setdefault("ATLAS_API_TOKEN", ATLAS_API_TOKEN or "dev-token")  # noqa: F405

ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver", "*"] if DEBUG else ALLOWED_HOSTS

# Dev fixtures: mock parity for the frontend without a running backend.
ATLAS_MOCK_MODE = True
