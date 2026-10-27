"""Typed exceptions and the MCP error surface (Doc 01 §9.7, Doc 08 §13.1).

Two rules drive this module:

1. Every failure leaves the adapter as a **normal tool result** whose text is a
   JSON body ``{"error": {...}}`` -- ``isError`` stays ``false`` so an agent can
   read ``hint`` and recover (Doc 08 §13.1 *Decision*).
2. The MCP ``code`` set is frozen to the seven values of Doc 01 §9.7.  Anything
   internal (a projection overflow, a transport defect) surfaces as a frozen
   code carrying ``detail.stage`` so the operator can tell a defect from a
   contract violation.
"""

from __future__ import annotations

import json
from typing import Any, Mapping

# --- frozen MCP codes (Doc 01 §9.7) ---------------------------------------

INVALID_ARGUMENT = "INVALID_ARGUMENT"
PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
TASK_NOT_FOUND = "TASK_NOT_FOUND"
TASK_CONFLICT = "TASK_CONFLICT"
LEASE_INVALID = "LEASE_INVALID"
BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE"
STORAGE_WRITE_FAILED = "STORAGE_WRITE_FAILED"

#: Doc 08 §13.1 additionally names ``PATH_OUT_OF_SCOPE`` and ``INTERNAL``; both
#: are adapter-local outcomes. PATH_OUT_OF_SCOPE is named in the §6.5/§13.1
#: mapping tables, and INTERNAL is the local-defect bucket of §13.1.
PATH_OUT_OF_SCOPE = "PATH_OUT_OF_SCOPE"
INTERNAL = "INTERNAL"

MCP_CODES = (
    INVALID_ARGUMENT,
    PATH_OUT_OF_SCOPE,
    PROJECT_NOT_FOUND,
    TASK_NOT_FOUND,
    TASK_CONFLICT,
    LEASE_INVALID,
    BACKEND_UNAVAILABLE,
    STORAGE_WRITE_FAILED,
    INTERNAL,
)

# --- hint enum (Doc 08 §11.2) --------------------------------------------

HINT_STOP_WORK_AND_RECLAIM = "STOP_WORK_AND_RECLAIM"
HINT_FIX_ARGUMENTS = "FIX_ARGUMENTS"
HINT_BACKOFF = "BACKOFF"
HINT_REPORT_TO_OPERATOR = "REPORT_TO_OPERATOR"

HINTS = (
    HINT_STOP_WORK_AND_RECLAIM,
    HINT_FIX_ARGUMENTS,
    HINT_BACKOFF,
    HINT_REPORT_TO_OPERATOR,
)

#: Default hint per code, per Doc 08 §13.1.
DEFAULT_HINTS: Mapping[str, str] = {
    INVALID_ARGUMENT: HINT_FIX_ARGUMENTS,
    PATH_OUT_OF_SCOPE: HINT_FIX_ARGUMENTS,
    PROJECT_NOT_FOUND: HINT_REPORT_TO_OPERATOR,
    TASK_NOT_FOUND: HINT_STOP_WORK_AND_RECLAIM,
    TASK_CONFLICT: HINT_BACKOFF,
    LEASE_INVALID: HINT_STOP_WORK_AND_RECLAIM,
    BACKEND_UNAVAILABLE: HINT_BACKOFF,
    STORAGE_WRITE_FAILED: HINT_REPORT_TO_OPERATOR,
    INTERNAL: HINT_REPORT_TO_OPERATOR,
}

REDACTED = "***"


# --- base type ------------------------------------------------------------


class McpError(Exception):
    """A failure that has a documented MCP representation."""

    code: str = INTERNAL

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        retryable: bool | None = None,
        hint: str | None = None,
        detail: Mapping[str, Any] | None = None,
        request_id: str | None = None,
    ) -> None:
        resolved_code = code or self.code
        super().__init__(message)
        self.message = redact(message)
        self.code = resolved_code
        self.retryable = bool(retryable) if retryable is not None else False
        self.hint = hint or DEFAULT_HINTS.get(resolved_code, HINT_REPORT_TO_OPERATOR)
        self.detail = dict(detail or {})
        self.request_id = request_id

    def to_body(self) -> dict[str, Any]:
        """Render the §7.8 / §13.1 error envelope."""
        body: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "hint": self.hint,
            "detail": self.detail,
            "request_id": self.request_id,
        }
        return {"error": body}

    def to_json(self) -> str:
        return json.dumps(self.to_body(), separators=(",", ":"), ensure_ascii=False)

    def __repr__(self) -> str:  # pragma: no cover - defensive
        return f"{type(self).__name__}(code={self.code!r}, message={self.message!r}, retryable={self.retryable!r})"


# --- concrete types -------------------------------------------------------


class InvalidArgument(McpError):
    code = INVALID_ARGUMENT

    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("retryable", False)
        kwargs.setdefault("hint", HINT_FIX_ARGUMENTS)
        super().__init__(message, **kwargs)


class PathOutOfScope(McpError):
    code = PATH_OUT_OF_SCOPE

    def __init__(self, path: str, root: str | None = None, **kwargs: Any) -> None:
        detail = dict(kwargs.pop("detail", {}) or {})
        detail["path"] = path
        if root:
            detail["storage_root"] = root
        kwargs.setdefault("retryable", False)
        kwargs.setdefault("hint", HINT_FIX_ARGUMENTS)
        super().__init__(
            f"path is outside ATLAS_STORAGE_ROOT: {path}",
            detail=detail,
            **kwargs,
        )
        self.path = path


class ProjectNotFound(McpError):
    code = PROJECT_NOT_FOUND

    def __init__(self, slug: str, **kwargs: Any) -> None:
        kwargs.setdefault("retryable", False)
        super().__init__(f"project '{slug}' does not exist", **kwargs)


class TaskNotFound(McpError):
    code = TASK_NOT_FOUND

    def __init__(self, task_id: str, **kwargs: Any) -> None:
        kwargs.setdefault("retryable", False)
        super().__init__(f"task {task_id} does not exist", **kwargs)


class TaskConflict(McpError):
    code = TASK_CONFLICT

    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("retryable", False)
        kwargs.setdefault("hint", HINT_BACKOFF)
        super().__init__(message, **kwargs)


class LeaseInvalid(McpError):
    code = LEASE_INVALID

    def __init__(self, message: str | None = None, **kwargs: Any) -> None:
        kwargs.setdefault("retryable", False)
        kwargs.setdefault("hint", HINT_STOP_WORK_AND_RECLAIM)
        super().__init__(message or "lease is no longer valid for this task", **kwargs)


class BackendUnavailable(McpError):
    code = BACKEND_UNAVAILABLE

    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("retryable", True)
        kwargs.setdefault("hint", HINT_BACKOFF)
        super().__init__(message, **kwargs)


class StorageWriteFailed(McpError):
    code = STORAGE_WRITE_FAILED

    def __init__(self, operation: str = "write", **kwargs: Any) -> None:
        kwargs.setdefault("retryable", False)
        kwargs.setdefault("hint", HINT_REPORT_TO_OPERATOR)
        super().__init__(f"storage write failed: {operation}", **kwargs)


class ProjectionTooLarge(McpError):
    """Internal defect: a projection still exceeded the 16 kB ceiling.

    Never a tool's normal output -- the agent must not receive silently
    truncated data, so this surfaces loudly (§8.4).
    """

    code = INTERNAL

    def __init__(self, *, tool: str, byte_size: int, limit: int) -> None:
        super().__init__(
            f"response projection exceeded budget ({byte_size} B > {limit} B)",
            retryable=False,
            hint=HINT_REPORT_TO_OPERATOR,
            detail={"stage": "projection", "tool": tool, "byte_size": byte_size, "limit": limit},
        )
        self.tool = tool
        self.byte_size = byte_size
        self.limit = limit


class InternalFault(McpError):
    code = INTERNAL

    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("retryable", False)
        kwargs.setdefault("hint", HINT_REPORT_TO_OPERATOR)
        super().__init__(message, **kwargs)


# --- helpers --------------------------------------------------------------

#: Map HTTP status -> (code, retryable) when the backend body carries no code.
_STATUS_FALLBACK: Mapping[int, tuple[str, bool]] = {
    400: (INVALID_ARGUMENT, False),
    401: (BACKEND_UNAVAILABLE, False),
    403: (BACKEND_UNAVAILABLE, False),
    404: (TASK_NOT_FOUND, False),
    409: (TASK_CONFLICT, False),
    413: (INVALID_ARGUMENT, False),
    415: (INVALID_ARGUMENT, False),
    422: (INVALID_ARGUMENT, False),
    500: (BACKEND_UNAVAILABLE, True),
    502: (BACKEND_UNAVAILABLE, True),
    503: (BACKEND_UNAVAILABLE, True),
    504: (BACKEND_UNAVAILABLE, True),
    507: (STORAGE_WRITE_FAILED, False),
}

#: Doc 08 §6.5 backend ``code`` -> MCP ``code``.
_BACKEND_CODE_MAP: Mapping[str, str] = {
    "VALIDATION_ERROR": INVALID_ARGUMENT,
    "PATH_OUT_OF_SCOPE": PATH_OUT_OF_SCOPE,
    "AUTH_MISSING": BACKEND_UNAVAILABLE,
    "AUTH_INVALID": BACKEND_UNAVAILABLE,
    "PROJECT_NOT_FOUND": PROJECT_NOT_FOUND,
    "TASK_NOT_FOUND": TASK_NOT_FOUND,
    "ASSET_NOT_FOUND": INVALID_ARGUMENT,
    "TASK_ALREADY_LEASED": TASK_CONFLICT,
    "STALE_LEASE": LEASE_INVALID,
    "LEASE_INVALID": LEASE_INVALID,
    "INVALID_TRANSITION": TASK_CONFLICT,
    "DEPENDENCY_CYCLE": TASK_CONFLICT,
    "DEPENDENCY_UNSATISFIABLE": TASK_CONFLICT,
    "PAYLOAD_TOO_LARGE": INVALID_ARGUMENT,
    "UNSUPPORTED_MEDIA_TYPE": INVALID_ARGUMENT,
    "INTERNAL_ERROR": BACKEND_UNAVAILABLE,
    "STORAGE_WRITE_FAILED": STORAGE_WRITE_FAILED,
    "BACKEND_UNAVAILABLE": BACKEND_UNAVAILABLE,
}

RETRYABLE_STATUS = frozenset({500, 502, 503, 504})

_TOKEN_PATTERN_HINTS = ("bearing ", "token ", "authorization")


def redact(text: str, token: str | None = None) -> str:
    """Strip anything token-shaped from a message before it reaches the agent."""
    if not text:
        return ""
    out = text
    if token:
        out = out.replace(token, REDACTED)
        out = out.replace(f"Bearer {token}", f"Bearer {REDACTED}")
    lowered = out.lower()
    if any(marker in lowered for marker in _TOKEN_PATTERN_HINTS):
        # Keep the sentence, drop the credential-shaped tail.
        for marker in ("bearer ", "authorization: "):
            idx = lowered.find(marker)
            if idx >= 0:
                end = out.find(" ", idx + len(marker))
                if end > 0:
                    out = out[: idx + len(marker)] + REDACTED + out[end:]
    return out


def _extract_backend_error(payload: Any) -> tuple[str | None, str | None, dict[str, Any], str | None]:
    """Pull ``(backend_code, message, detail, request_id)`` out of a response body."""
    if not isinstance(payload, Mapping):
        return None, None, {}, None
    node = payload.get("error")
    if isinstance(node, Mapping):
        detail = node.get("detail")
        return (
            node.get("code") if isinstance(node.get("code"), str) else None,
            node.get("message") if isinstance(node.get("message"), str) else None,
            dict(detail) if isinstance(detail, Mapping) else {},
            node.get("request_id") if isinstance(node.get("request_id"), str) else None,
        )
    # Tolerate a flat body (some middleware may flatten the envelope).
    return (
        payload.get("code") if isinstance(payload.get("code"), str) else None,
        payload.get("message") if isinstance(payload.get("message"), str) else None,
        {},
        payload.get("request_id") if isinstance(payload.get("request_id"), str) else None,
    )


def from_response(status_code: int, payload: Any, *, base_url: str, request_id: str | None = None) -> McpError:
    """Translate a non-2xx backend response into the documented MCP error."""
    backend_code, message, detail, echoed_id = _extract_backend_error(payload)
    rid = echoed_id or request_id

    if backend_code and backend_code in _BACKEND_CODE_MAP:
        mcp_code = _BACKEND_CODE_MAP[backend_code]
    else:
        mcp_code = _STATUS_FALLBACK.get(status_code, (INTERNAL, False))[0]

    retryable = status_code in RETRYABLE_STATUS
    if status_code in (401, 403):
        # Frozen code set: auth failures look like an outage, but a retry cannot help.
        message = f"ATLAS backend rejected the request at {base_url}"
        retryable = False
    if backend_code:
        detail.setdefault("backend_code", backend_code)

    text = redact(message or _default_message(mcp_code, base_url, status_code))

    if mcp_code == BACKEND_UNAVAILABLE:
        return BackendUnavailable(text, retryable=retryable, detail=detail, request_id=rid)
    if mcp_code == LEASE_INVALID:
        hint = HINT_STOP_WORK_AND_RECLAIM
        detail.setdefault("next", "claim_next_task")
        detail.setdefault("discard_local_changes", False)
        return McpError(text, code=mcp_code, retryable=False, hint=hint, detail=detail, request_id=rid)
    if mcp_code == TASK_CONFLICT:
        return McpError(text, code=mcp_code, retryable=False, hint=HINT_BACKOFF, detail=detail, request_id=rid)
    if mcp_code == PROJECT_NOT_FOUND:
        return McpError(text, code=mcp_code, retryable=False, hint=HINT_REPORT_TO_OPERATOR, detail=detail, request_id=rid)
    if mcp_code == TASK_NOT_FOUND:
        return McpError(text, code=mcp_code, retryable=False, hint=HINT_STOP_WORK_AND_RECLAIM, detail=detail, request_id=rid)
    if mcp_code == STORAGE_WRITE_FAILED:
        return McpError(text, code=mcp_code, retryable=False, hint=HINT_REPORT_TO_OPERATOR, detail=detail, request_id=rid)
    if mcp_code == PATH_OUT_OF_SCOPE:
        return McpError(text, code=mcp_code, retryable=False, hint=HINT_FIX_ARGUMENTS, detail=detail, request_id=rid)
    if mcp_code == INVALID_ARGUMENT:
        return McpError(text, code=mcp_code, retryable=False, hint=HINT_FIX_ARGUMENTS, detail=detail, request_id=rid)
    return McpError(text, code=mcp_code, retryable=retryable, detail=detail, request_id=rid)


def _default_message(code: str, base_url: str, status_code: int) -> str:
    if code == BACKEND_UNAVAILABLE:
        return f"ATLAS backend unreachable at {base_url}"
    if code == STORAGE_WRITE_FAILED:
        return "storage write failed"
    return f"ATLAS backend returned HTTP {status_code}"
