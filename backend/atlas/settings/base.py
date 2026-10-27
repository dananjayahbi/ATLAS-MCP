"""Shared Django settings (Doc 01 §13, Doc 02 §3).

DB tuning, app registry, and security posture live here. Dev/prod layer their
own DEBUG/token policy on top.
"""

from __future__ import annotations

import secrets
from pathlib import Path

from atlas.env import (
    BACKEND_DIR,
    REPO_ROOT,
    env_bool,
    env_int,
    env_path,
    env_str,
    load_dotenv,
)

load_dotenv(REPO_ROOT / ".env")

SECRET_KEY = env_str("ATLAS_SECRET_KEY", "dev-only-insecure-secret-key-change-me")
DEBUG = env_bool("ATLAS_DEBUG", False)

ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver"]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "api",
]

MIDDLEWARE = [
    "api.common.middleware.RequestIdMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "api.common.middleware.ApiAuthMiddleware",
]

ROOT_URLCONF = "atlas.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

WSGI_APPLICATION = "atlas.wsgi.application"
ASGI_APPLICATION = "atlas.asgi.application"

# --------------------------------------------------------------------------
# Paths (Doc 01 §4, §13)
# --------------------------------------------------------------------------
ATLAS_REPO_ROOT = REPO_ROOT
ATLAS_STORAGE_ROOT = env_path("ATLAS_STORAGE_ROOT", REPO_ROOT / "storage").resolve()
ATLAS_DB_PATH = env_path("ATLAS_DB_PATH", BACKEND_DIR / "data" / "atlas.db").resolve()
ATLAS_WEB_ORIGIN = env_str("ATLAS_WEB_ORIGIN", "http://localhost:3471")
ATLAS_ENV = env_str("ATLAS_ENV", "dev")

# --------------------------------------------------------------------------
# Tokens & limits (Doc 01 §13, §14)
# --------------------------------------------------------------------------
ATLAS_API_TOKEN = env_str(
    "ATLAS_API_TOKEN", "dev-token" if env_str("ATLAS_ENV", "dev") != "prod" else ""
)
ATLAS_MAX_UPLOAD_MB = env_int("ATLAS_MAX_UPLOAD_MB", 25)
ATLAS_MAX_PATCH_BYTES = 5 * 1024 * 1024
ATLAS_LOG_LEVEL = env_str("ATLAS_LOG_LEVEL", "INFO")

# Lease parameters are FROZEN (Doc 01 §11.2) — env vars exist only for tests.
ATLAS_LEASE_TTL_SECONDS = env_int("ATLAS_LEASE_TTL_SECONDS", 900)
ATLAS_HEARTBEAT_INTERVAL_SECONDS = env_int("ATLAS_HEARTBEAT_INTERVAL_SECONDS", 120)
ATLAS_RECLAIM_GRACE_SECONDS = env_int("ATLAS_RECLAIM_GRACE_SECONDS", 60)
ATLAS_SSE_KEEPALIVE_SECONDS = env_int("ATLAS_SSE_KEEPALIVE_SECONDS", 15)
ATLAS_SWEEPER_INTERVAL_SECONDS = env_int("ATLAS_SWEEPER_INTERVAL_SECONDS", 60)

# Doc 01 §16 mock parity: fixtures live under frontend/lib/mocks.
ATLAS_FIXTURES_DIR = REPO_ROOT / "frontend" / "lib" / "mocks"

# --------------------------------------------------------------------------
# Database — SQLite with WAL (Doc 02 §3)
# --------------------------------------------------------------------------
ATLAS_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": str(ATLAS_DB_PATH),
        "OPTIONS": {
            "timeout": 5.0,  # 5000 ms busy timeout (master §5.1)
            "transaction_mode": "IMMEDIATE",  # write lock at BEGIN (Doc 01 §11.1)
            "init_command": (
                "PRAGMA journal_mode=WAL;"
                "PRAGMA synchronous=NORMAL;"
                "PRAGMA foreign_keys=ON;"
                "PRAGMA temp_store=MEMORY;"
                "PRAGMA mmap_size=134217728;"
                "PRAGMA busy_timeout=5000;"
            ),
        },
        "ATOMIC_REQUESTS": False,
        "CONN_MAX_AGE": 0,
        "TEST": {"NAME": str(BACKEND_DIR / "data" / "test_atlas.db")},
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------
# DRF
# --------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["api.common.renderers.AtlasJSONRenderer"],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "api.common.errors.atlas_exception_handler",
}

CORS_ALLOWED_ORIGINS = [ATLAS_WEB_ORIGIN]
CORS_ALLOW_CREDENTIALS = False
CORS_ALLOW_HEADERS = [
    "authorization",
    "content-type",
    "x-atlas-agent",
    "x-request-id",
    "last-event-id",
]

APPEND_SLASH = True

# --------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "atlas": {
            "format": "%(asctime)s %(levelname)-7s %(name)s :: %(message)s",
        }
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "atlas"},
    },
    "root": {"handlers": ["console"], "level": ATLAS_LOG_LEVEL},
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "atlas": {"handlers": ["console"], "level": ATLAS_LOG_LEVEL, "propagate": False},
    },
}

USE_TZ = True
TIME_ZONE = "UTC"

# Static files are not used (the HUD is served by Next.js) but `staticfiles`
# is installed and `runserver` insists on a STATIC_URL.
STATIC_URL = "/static/"
STATIC_ROOT = BACKEND_DIR / "staticfiles"

# Restart-generation marker used by SSE `stream.reset` (Doc 09).
ATLAS_BOOT_ID = secrets.token_hex(8)

# Guard against accidentally shipping the dev token to a non-loopback bind.
if ATLAS_ENV == "prod" and ATLAS_API_TOKEN in {"", "dev-token"}:
    raise RuntimeError("ATLAS_ENV=prod requires a non-default ATLAS_API_TOKEN")


def _as_posix(path: Path) -> str:
    return str(path).replace("\\", "/")


ATLAS_STORAGE_ROOT_POSIX = _as_posix(ATLAS_STORAGE_ROOT)
