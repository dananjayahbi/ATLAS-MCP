"""Tool registry (Doc 08 §5.2).

``TOOLS`` holds one :class:`ToolSpec` per tool in the frozen registration order:
the four core tools first, so an agent facing a truncated tool list still sees
the protocol-critical four.

**Division of responsibility.** ``MCPServer`` validates arguments against a model
it derives from the handler signature, and a failure there surfaces as a
protocol-level ``isError`` result -- not the JSON body Doc 01 §9.7 requires.  So
each registered handler declares ``Any`` parameters (a deliberately permissive
boundary), the published ``inputSchema`` is overwritten with the frozen dict from
``schemas/``, and *all* constraint enforcement happens in the frozen pydantic
model.  That keeps every argument error inside the documented
``INVALID_ARGUMENT`` surface.

``extra="forbid"`` stays on both models.  An unknown key is a real schema
violation with no recoverable JSON contract, so it may surface as ``isError``;
everything else returns a body the agent can read.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Mapping

from pydantic import ValidationError

from ..errors import InternalFault, InvalidArgument, McpError

LOGGER = logging.getLogger("atlas.mcp.tools")

RegisterFn = Callable[[Any, Any, Any], None]


@dataclass(frozen=True)
class ToolSpec:
    """A tool's frozen identity plus its registration callable."""

    name: str
    description: str
    register: RegisterFn

    def __call__(self, mcp: Any, cfg: Any, client: Any) -> None:
        self.register(mcp, cfg, client)


def emit(body: Mapping[str, Any]) -> str:
    """Serialise a tool result to the single JSON text block MCP carries.

    Compact separators matter: they are the bytes measured against the 16 kB
    ceiling (§8.4) and the reason ``log_task_progress`` is 11 bytes on the wire.
    """
    return json.dumps(dict(body), separators=(",", ":"), ensure_ascii=False)


def payload(**values: Any) -> dict:
    """Drop omitted values so the frozen model applies its own defaults."""
    return {key: value for key, value in values.items() if value is not None}


def describe_validation_error(exc: ValidationError) -> str:
    """Render a pydantic error as ``<field>: <constraint violated>`` (§13.1)."""
    parts: list[str] = []
    for error in exc.errors()[:4]:
        location = ".".join(str(item) for item in error.get("loc") or ()) or "arguments"
        message = str(error.get("msg") or "invalid value")
        parts.append(f"{location}: {message}")
    return "; ".join(parts) or "arguments: invalid"


def invoke(model_cls: type, raw: Mapping[str, Any], handler: Callable[[Any], dict]) -> str:
    """Validate ``raw`` into ``model_cls``, run ``handler``, return JSON text.

    Argument problems become an ``INVALID_ARGUMENT`` body rather than a raised
    exception, so the agent reads the hint and fixes the call instead of treating
    the whole run as fatal (§13.1).  Everything else is already an
    :class:`McpError` from ``client``/``paths``; an unexpected one is bucketed as
    ``INTERNAL`` with the short exception text, never a raw traceback.
    """
    try:
        args = model_cls.model_validate(dict(raw))
    except ValidationError as exc:
        error = InvalidArgument(describe_validation_error(exc))
        LOGGER.info("invalid arguments model=%s detail=%s", model_cls.__name__, error.message)
        return emit(error.to_body())

    try:
        result = handler(args)
    except McpError as exc:
        LOGGER.warning(
            "tool failed model=%s code=%s retryable=%s req=%s msg=%s",
            model_cls.__name__,
            exc.code,
            exc.retryable,
            exc.request_id,
            exc.message,
        )
        return emit(exc.to_body())
    except Exception as exc:  # noqa: BLE001 - a crash must not escape as a raw error
        LOGGER.exception("unhandled tool fault model=%s", model_cls.__name__)
        return emit(InternalFault(f"{type(exc).__name__}: {exc}").to_body())

    return emit(result)


def publish_frozen(mcp: Any, *, name: str, description: str, params: Mapping[str, Any]) -> None:
    """Overwrite the published tool schema with the frozen Doc 01 contract."""
    tool = _find_tool(mcp, name)
    if tool is None:  # pragma: no cover - defensive: registration always precedes
        return
    tool.parameters = dict(params)
    tool.description = description
    metadata = getattr(tool, "fn_metadata", None)
    arg_model = getattr(metadata, "arg_model", None)
    if arg_model is not None:
        try:
            arg_model.model_config["extra"] = "forbid"
            arg_model.model_rebuild(force=True)
        except Exception:  # pragma: no cover - a rebuild failure must not break startup
            LOGGER.debug("could not tighten arg model for %s", name, exc_info=True)


def _find_tool(mcp: Any, name: str) -> Any:
    manager = getattr(mcp, "_tool_manager", None)
    getter = getattr(manager, "get_tool", None)
    if getter is None:
        return None
    try:
        return getter(name)
    except Exception:  # pragma: no cover - defensive
        return None


# --- frozen registration order (§5.2) -------------------------------------

from .claim import REGISTER as _register_claim  # noqa: E402
from .claim_limit import REGISTER as _register_claim_limit  # noqa: E402
from .propose import REGISTER as _register_propose  # noqa: E402
from .submit import REGISTER as _register_submit  # noqa: E402
from .progress import REGISTER as _register_progress  # noqa: E402
from .heartbeat import REGISTER as _register_heartbeat  # noqa: E402
from .dod import REGISTER as _register_dod  # noqa: E402
from .subtask import REGISTER as _register_subtask  # noqa: E402
from .detail import REGISTER as _register_detail  # noqa: E402
from .search import REGISTER as _register_search  # noqa: E402

TOOLS: list[ToolSpec] = [
    _register_claim,
    _register_propose,
    _register_submit,
    _register_progress,
    _register_heartbeat,
    _register_dod,
    _register_subtask,
    _register_detail,
    # Orientation + escalation tools come last so a truncated tool list still
    # shows the protocol-critical core first.
    _register_search,
    _register_claim_limit,
]

#: Doc 08 §5.2 name for the same list.
ALL_TOOLS = TOOLS

TOOL_NAMES = tuple(spec.name for spec in TOOLS)

__all__ = [
    "ALL_TOOLS",
    "TOOLS",
    "TOOL_NAMES",
    "ToolSpec",
    "describe_validation_error",
    "emit",
    "invoke",
    "payload",
    "publish_frozen",
]
