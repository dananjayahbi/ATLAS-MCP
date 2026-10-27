"""Configuration: environment + CLI flag merge and validation (Doc 08 §4.1).

Validation is fatal on purpose: a missing URL or token is an operator mistake
that no retry can fix, so the process exits 2 with a message that names the
variable and the violated rule -- and never echoes the token value (§14.1).
An unreachable backend, by contrast, is *not* fatal (§4.3): the caller probes
``/healthz`` once and continues in ``Degraded`` mode.
"""

from __future__ import annotations

import argparse
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping, Sequence
from urllib.parse import urlsplit, urlunsplit

from . import __version__

# --- identifier / enum grammars (Doc 01 §5, §6.2) -------------------------

AGENT_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{2,63}$")
PROJECT_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")

LOG_LEVELS = ("DEBUG", "INFO", "WARN", "ERROR")
PLACEHOLDER_TOKENS = frozenset({"changeme", "dev", "test"})
MIN_TOKEN_LENGTH = 16

# --- frozen lease constants (Doc 01 §11.2) --------------------------------

LEASE_TTL_DEFAULT = 900
LEASE_TTL_MIN = 60
LEASE_TTL_MAX = 3600
HEARTBEAT_INTERVAL_DEFAULT = 120
HEARTBEAT_INTERVAL_MIN = 10
HEARTBEAT_INTERVAL_MAX = 3600

DEFAULT_AGENT_ID = "Agent-Unknown"
DEFAULT_LOG_LEVEL = "INFO"


class ConfigError(Exception):
    """Fatal startup misconfiguration. The process must exit with code 2."""


@dataclass(frozen=True)
class Settings:
    """Resolved, validated adapter configuration."""

    backend_url: str
    api_token: str = field(repr=False)
    agent_id: str = DEFAULT_AGENT_ID
    project_slug: str | None = None
    storage_root: str | None = None
    lease_ttl_seconds: int = LEASE_TTL_DEFAULT
    heartbeat_interval_seconds: int = HEARTBEAT_INTERVAL_DEFAULT
    log_level: str = DEFAULT_LOG_LEVEL
    debug: bool = False
    long_path_prefix: bool = False
    version: str = __version__
    warnings: tuple[str, ...] = ()

    # The token is only ever readable through this method, and only for the
    # outbound Authorization header.
    def auth_header(self) -> str:
        return f"Bearer {self.api_token}"

    def banner(self) -> str:
        """One startup line with the token redacted (§13.2)."""
        return (
            f"atlas-mcp {self.version} backend={self.backend_url} "
            f"agent={self.agent_id} project={self.project_slug or '-'} token=***"
        )

    def __repr__(self) -> str:  # pragma: no cover - defensive, asserted in tests
        return (
            f"Settings(backend_url={self.backend_url!r}, api_token='***', "
            f"agent_id={self.agent_id!r}, project_slug={self.project_slug!r}, "
            f"storage_root={self.storage_root!r}, "
            f"lease_ttl_seconds={self.lease_ttl_seconds!r}, "
            f"heartbeat_interval_seconds={self.heartbeat_interval_seconds!r}, "
            f"log_level={self.log_level!r}, debug={self.debug!r})"
        )


# --- helpers --------------------------------------------------------------


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _parse_backend_url(raw: str | None) -> str:
    if not raw or not raw.strip():
        raise ConfigError(
            "ATLAS_BACKEND_URL is required (no default); set it to e.g. http://127.0.0.1:8000"
        )
    value = raw.strip()
    parts = urlsplit(value)
    if parts.scheme.lower() not in ("http", "https"):
        raise ConfigError(
            f"ATLAS_BACKEND_URL must be an http:// or https:// URL (got scheme {parts.scheme!r})"
        )
    if not parts.hostname:
        raise ConfigError("ATLAS_BACKEND_URL must include a host")
    if parts.query or parts.fragment:
        raise ConfigError("ATLAS_BACKEND_URL must not carry a query string or fragment")
    path = parts.path.rstrip("/")
    return urlunsplit((parts.scheme.lower(), parts.netloc, path, "", ""))


def _parse_token(raw: str | None) -> str:
    if not raw or not raw.strip():
        raise ConfigError("ATLAS_API_TOKEN is required and must come from the environment, never a CLI flag")
    token = raw.strip()
    if len(token) < MIN_TOKEN_LENGTH:
        raise ConfigError(
            f"ATLAS_API_TOKEN must be at least {MIN_TOKEN_LENGTH} characters (got {len(token)})"
        )
    if token.lower() in PLACEHOLDER_TOKENS:
        raise ConfigError("ATLAS_API_TOKEN must not be a placeholder such as 'changeme', 'dev' or 'test'")
    return token


def _parse_int(name: str, raw: str | None, default: int, lo: int, hi: int) -> int:
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip(), 10)
    except (TypeError, ValueError):
        raise ConfigError(f"{name} must be an integer (got {raw!r})") from None
    if not lo <= value <= hi:
        raise ConfigError(f"{name} must be between {lo} and {hi} (got {value})")
    return value


def _parse_storage_root(raw: str | None, warnings: list[str]) -> str | None:
    value = _clean(raw)
    if value is None:
        return None
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        raise ConfigError(f"ATLAS_STORAGE_ROOT must be an absolute path (got {value!r})")
    resolved = str(candidate)
    if not candidate.is_dir():
        warnings.append(f"ATLAS_STORAGE_ROOT does not exist yet: {resolved} (containment pre-check stays active)")
    return resolved


def _parse_log_level(raw: str | None) -> str:
    value = (_clean(raw) or DEFAULT_LOG_LEVEL).upper()
    if value == "WARNING":
        value = "WARN"
    if value not in LOG_LEVELS:
        raise ConfigError(f"ATLAS_LOG_LEVEL must be one of {', '.join(LOG_LEVELS)} (got {value!r})")
    return value


def _parse_agent_id(raw: str | None, warnings: list[str]) -> str:
    value = _clean(raw)
    if value is None:
        return DEFAULT_AGENT_ID
    if not AGENT_ID_RE.match(value):
        raise ConfigError(
            "ATLAS_AGENT_ID must match ^[A-Za-z][A-Za-z0-9._-]{2,63}$ "
            f"(got {value!r}); it is also the X-ATLAS-Agent header"
        )
    return value


def _parse_project_slug(raw: str | None) -> str | None:
    value = _clean(raw)
    if value is None:
        return None
    if not PROJECT_SLUG_RE.match(value):
        raise ConfigError(
            "ATLAS_PROJECT_SLUG must match ^[a-z][a-z0-9-]{1,31}$ (got %r)" % value
        )
    return value


# --- public API -----------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m mcp_server",
        description=(
            "ATLAS MCP protocol adapter (stdio). Speaks MCP JSON-RPC on stdin/stdout "
            "and forwards tool calls to the Django core over /internal/v1."
        ),
        epilog=(
            "Required environment: ATLAS_BACKEND_URL, ATLAS_API_TOKEN. "
            "The token is never accepted as a CLI flag."
        ),
    )
    parser.add_argument("--project", metavar="<slug>", default=None, help="default project_slug (overrides ATLAS_PROJECT_SLUG)")
    parser.add_argument("--agent", metavar="<id>", default=None, help="default agent_identifier (overrides ATLAS_AGENT_ID)")
    parser.add_argument("--backend-url", metavar="<url>", default=None, help="dev convenience override for ATLAS_BACKEND_URL")
    parser.add_argument("--debug", action="store_true", default=False, help="redacted request/response logging to stderr")
    parser.add_argument("--version", action="version", version=f"atlas-mcp {__version__}")
    return parser


def load(env: Mapping[str, str] | None = None, argv: Sequence[str] | None = None) -> Settings:
    """Merge environment and argv into a validated :class:`Settings`."""

    environ: Mapping[str, str] = os.environ if env is None else env
    args = build_parser().parse_args(list(argv or ()))
    warnings: list[str] = []

    backend_url = _parse_backend_url(args.backend_url or environ.get("ATLAS_BACKEND_URL"))
    api_token = _parse_token(environ.get("ATLAS_API_TOKEN"))

    agent_id = _parse_agent_id(args.agent or environ.get("ATLAS_AGENT_ID"), warnings)
    project_slug = _parse_project_slug(args.project or environ.get("ATLAS_PROJECT_SLUG"))
    storage_root = _parse_storage_root(environ.get("ATLAS_STORAGE_ROOT"), warnings)

    lease_ttl = _parse_int(
        "ATLAS_LEASE_TTL_SECONDS",
        environ.get("ATLAS_LEASE_TTL_SECONDS"),
        LEASE_TTL_DEFAULT,
        LEASE_TTL_MIN,
        LEASE_TTL_MAX,
    )
    heartbeat = _parse_int(
        "ATLAS_HEARTBEAT_INTERVAL_SECONDS",
        environ.get("ATLAS_HEARTBEAT_INTERVAL_SECONDS"),
        HEARTBEAT_INTERVAL_DEFAULT,
        HEARTBEAT_INTERVAL_MIN,
        HEARTBEAT_INTERVAL_MAX,
    )
    if heartbeat >= lease_ttl / 2:
        clamped = lease_ttl // 3
        warnings.append(
            f"ATLAS_HEARTBEAT_INTERVAL_SECONDS={heartbeat} must be < lease_ttl/2 ({lease_ttl / 2:g}); "
            f"clamped to {clamped}"
        )
        heartbeat = clamped

    log_level = _parse_log_level(environ.get("ATLAS_LOG_LEVEL"))
    long_path_prefix = (environ.get("ATLAS_LONG_PATH_PREFIX") or "").strip() in ("1", "true", "TRUE", "yes")

    return Settings(
        backend_url=backend_url,
        api_token=api_token,
        agent_id=agent_id,
        project_slug=project_slug,
        storage_root=storage_root,
        lease_ttl_seconds=lease_ttl,
        heartbeat_interval_seconds=heartbeat,
        log_level=log_level,
        debug=bool(args.debug),
        long_path_prefix=long_path_prefix,
        version=__version__,
        warnings=tuple(warnings),
    )


def load_from_argv(argv: Sequence[str] | None = None) -> Settings:
    """Entry point used by ``server.main``; receives argv, never the whole process."""
    return load(os.environ, argv)
