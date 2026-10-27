"""Synchronous ``httpx`` adapter for ``/internal/v1`` (Doc 08 §6).

Handlers are sync and FastMCP serialises tool calls per session, so a sync
client keeps the "no shared mutable state" guarantee honest: there is exactly
one in-flight request and nothing to race.

Retry policy is Doc 01 §9.7, verbatim: one attempt plus **exactly two**
retries with fixed 250 ms / 750 ms backoff, replayed from pre-serialised bytes
so the body is byte-identical, and a fresh ``X-Request-ID`` per attempt so a
retry is distinguishable in the Django log.  ``claim_next_task`` and
``spawn_subtask`` pass ``retries=0`` because a replayed claim could lease a
*different* task and a replayed subtask would create a duplicate child (§12.2).
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Mapping

import httpx

from . import __version__
from .config import Settings
from .errors import (
    BackendUnavailable,
    InternalFault,
    McpError,
    RETRYABLE_STATUS,
    from_response,
)

LOGGER = logging.getLogger("atlas.mcp.client")

RETRY_DELAYS = (0.25, 0.75)  # exactly two retries

CLAIM_PATH = "/internal/v1/claim"
PROPOSE_PATH = "/internal/v1/propose"
SUBMIT_PATH = "/internal/v1/submit"
PROGRESS_PATH = "/internal/v1/progress"
HEARTBEAT_PATH = "/internal/v1/heartbeat"
DOD_PATH = "/internal/v1/dod"
SUBTASK_PATH = "/internal/v1/subtask"
TASK_PATH = "/internal/v1/task"
HEALTH_PATH = "/healthz"

#: Transport faults that are never retried because a replay cannot fix them.
NON_RETRYABLE_TRANSPORT = (
    httpx.InvalidURL,
    httpx.UnsupportedProtocol,
    httpx.LocalProtocolError,
)

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_ulid(prefix: str = "", *, timestamp_ms: int | None = None) -> str:
    """Generate a 26-char Crockford-base32 ULID, optionally prefixed.

    Kept local (no dependency) because request ids are the only ULID this
    process ever mints.
    """
    ts = int(time.time() * 1000) if timestamp_ms is None else int(timestamp_ms)
    ts_chars = []
    remaining = ts
    for _ in range(10):
        ts_chars.append(_CROCKFORD[remaining & 0x1F])
        remaining >>= 5
    ts_part = "".join(reversed(ts_chars))
    random_part = "".join(_CROCKFORD[b & 0x1F] for b in os.urandom(16))
    return f"{prefix}{ts_part}{random_part}"


def new_request_id() -> str:
    return new_ulid("req_")


def compact_dumps(payload: Any) -> bytes:
    """Serialise once, as bytes, so every retry replays identically."""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _redact_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Debug-safe view of a request body (§13.4)."""
    out: dict[str, Any] = {}
    for key, value in payload.items():
        if key in ("git_patch", "verification_log"):
            size = len(value.encode("utf-8")) if isinstance(value, str) else 0
            out[key] = f"<{size} bytes>"
        elif key in ("description", "message", "summary_of_work") and isinstance(value, str):
            out[key] = f"{value[:120]}…({len(value)} chars)"
        elif key in ("project_rules",):
            out[key] = f"<{len(value)} chars>"
        elif key == "attached_images" and isinstance(value, list):
            out[key] = value[:1]
        else:
            out[key] = value
    return out


class AtlasClient:
    """Thin, stateless HTTP adapter. One instance per MCP server process."""

    def __init__(self, cfg: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self._cfg = cfg
        self._base_url = cfg.backend_url
        headers = {
            "Authorization": cfg.auth_header(),
            "X-ATLAS-Agent": cfg.agent_id,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": f"atlas-mcp/{__version__} (python-httpx)",
        }
        self._http = httpx.Client(
            base_url=cfg.backend_url,
            headers=headers,
            transport=transport,
            timeout=httpx.Timeout(connect=3.0, read=10.0, write=30.0, pool=3.0),
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
            follow_redirects=False,
            trust_env=False,
            http2=False,
        )

    # -- lifecycle ---------------------------------------------------------

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "AtlasClient":
        return self

    def __exit__(self, *exc_info: Any) -> None:
        self.close()

    @property
    def base_url(self) -> str:
        return self._base_url

    # -- transport ---------------------------------------------------------

    def post(self, path: str, payload: Mapping[str, Any], *, retries: int = 2, tool: str = "") -> dict:
        """POST ``payload`` to ``path`` and return the decoded JSON body.

        Raises an :class:`~mcp_server.errors.McpError` for every failure mode;
        never a raw ``httpx`` exception, so handlers stay free of HTTP details.
        """
        body = compact_dumps(dict(payload))
        if self._cfg.debug:
            LOGGER.debug(
                "request tool=%s path=%s body=%s",
                tool or "-",
                path,
                _redact_payload(payload),
            )

        last: McpError | None = None
        attempts = max(0, retries) + 1
        for attempt in range(attempts):
            request_id = new_request_id()
            started = time.monotonic()
            try:
                response = self._http.post(
                    path,
                    content=body,
                    headers={"X-Request-ID": request_id},
                )
            except NON_RETRYABLE_TRANSPORT as exc:
                raise InternalFault(
                    f"{type(exc).__name__}: {exc}",
                    request_id=request_id,
                    detail={"stage": "transport", "tool": tool} if tool else {"stage": "transport"},
                ) from exc
            except httpx.HTTPError as exc:
                # TransportError subclasses (ConnectError, ReadTimeout, ...) and
                # anything else the transport raises: retryable while budget lasts.
                # The surfaced error stays `retryable: true` because the agent may
                # still retry after a pause (§13.1); only the adapter's own budget
                # is exhausted here.
                last = BackendUnavailable(
                    f"ATLAS backend unreachable at {self._base_url}",
                    retryable=True,
                    detail={"stage": "transport", "error": type(exc).__name__},
                    request_id=request_id,
                )
            else:
                elapsed_ms = int((time.monotonic() - started) * 1000)
                if response.status_code in RETRYABLE_STATUS:
                    last = BackendUnavailable(
                        f"ATLAS backend unreachable at {self._base_url}",
                        retryable=True,
                        detail={"stage": "http", "status": response.status_code},
                        request_id=request_id,
                    )
                elif response.status_code >= 400:
                    raise from_response(
                        response.status_code,
                        _safe_json(response),
                        base_url=self._base_url,
                        request_id=request_id,
                    )
                else:
                    data = _safe_json(response)
                    if not isinstance(data, dict):
                        raise InternalFault(
                            f"backend returned a non-object JSON body (HTTP {response.status_code})",
                            request_id=request_id,
                            detail={"stage": "decode", "tool": tool} if tool else {"stage": "decode"},
                        )
                    if self._cfg.debug:
                        LOGGER.debug(
                            "response tool=%s path=%s status=%s elapsed_ms=%s bytes=%s keys=%s",
                            tool or "-",
                            path,
                            response.status_code,
                            elapsed_ms,
                            len(response.content),
                            sorted(data)[:12],
                        )
                    return data

            if attempt < attempts - 1:
                LOGGER.warning(
                    "%s attempt=%d/%d code=%s req=%s",
                    tool or path,
                    attempt + 1,
                    attempts,
                    last.code if last else "?",
                    request_id,
                )
                time.sleep(RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)])

        assert last is not None  # loop always sets or raises
        raise last

    # -- health probe (§4.3) ----------------------------------------------

    def probe_health(self, timeout: float = 1.5) -> tuple[bool, str]:
        """One non-retried ``GET /healthz``. Its result is only ever a log line."""
        try:
            response = self._http.get(HEALTH_PATH, timeout=httpx.Timeout(timeout))
        except httpx.HTTPError as exc:
            return False, f"{type(exc).__name__}: {exc}"
        if response.status_code >= 400:
            return False, f"HTTP {response.status_code}"
        return True, "ok"


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return {"message": response.text[:400]} if response.text else {}
