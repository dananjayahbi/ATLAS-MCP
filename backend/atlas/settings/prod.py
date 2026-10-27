"""Production settings: DEBUG off, token enforced (Doc 01 §14)."""

from __future__ import annotations

from atlas.settings.base import *  # noqa: F401,F403

DEBUG = False

# base.py already refuses a default token when ATLAS_ENV=prod.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "no-referrer"
X_FRAME_OPTIONS = "DENY"

ATLAS_MOCK_MODE = False
