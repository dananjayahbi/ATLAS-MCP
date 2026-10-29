"""``task_heartbeat`` -- ``POST /internal/v1/heartbeat`` (Doc 08 §7.5).

Called by the **agent**, never by a server-side timer: a keep-alive inside the
adapter would keep a *dead* agent's lease alive and defeat crash recovery
(§11.1, P5).  A ``409 STALE_LEASE`` surfaces as ``LEASE_INVALID`` carrying
``hint: STOP_WORK_AND_RECLAIM``.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Callable

from pydantic import BaseModel, ConfigDict, Field

from ..client import HEARTBEAT_PATH
from ..projections import project_heartbeat
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.heartbeat")

NAME = "task_heartbeat"
DESCRIPTION = (
    "Reports that the agent is still working and re-estimates the completion time "
    "(+900 s). Leases are advisory: missing the estimate never reclaims the task, it "
    "only marks it OVERDUE until the next heartbeat. Call this every "
    "heartbeat_interval_seconds."
)

#: ULID-based lease id, Crockford base32, per Doc 01 §5.
LEASE_ID_PATTERN = r"^lea_[0-9A-HJKMNP-TV-Z]{26}$"

HEARTBEAT_PARAMS: dict = {
    "type": "object",
    "properties": {
        "task_id": {"type": "string"},
        "lease_id": {"type": "string", "pattern": LEASE_ID_PATTERN},
    },
    "required": ["task_id", "lease_id"],
}

HEARTBEAT_RETURNS: dict = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean"},
        "lease_expires_at": {"type": "string", "description": "ISO-8601 UTC Z"},
        "seconds_remaining": {"type": "integer"},
        "is_overdue": {
            "type": "boolean",
            "description": "True only if the renewed estimate is already blown.",
        },
        "lease_seconds_overdue": {"type": "integer", "minimum": 0},
    },
    "required": ["ok", "lease_expires_at", "seconds_remaining"],
}


class HeartbeatArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    task_id: Annotated[str, Field(min_length=1, max_length=64)]
    lease_id: Annotated[str, Field(pattern=LEASE_ID_PATTERN)]


def make_handler(cfg: Any, client: Any) -> Callable[[HeartbeatArgs], dict]:
    def handler(args: HeartbeatArgs) -> dict:
        raw = client.post(
            HEARTBEAT_PATH,
            {"task_id": args.task_id, "lease_id": args.lease_id},
            retries=2,
            tool=NAME,
        )
        return project_heartbeat(raw)

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def task_heartbeat(task_id: Any, lease_id: Any) -> str:
        return invoke(HeartbeatArgs, payload(task_id=task_id, lease_id=lease_id), handler)

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(task_heartbeat)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=HEARTBEAT_PARAMS)


__all__ = [
    "DESCRIPTION",
    "HEARTBEAT_PARAMS",
    "HEARTBEAT_RETURNS",
    "HeartbeatArgs",
    "NAME",
    "REGISTER",
    "make_handler",
    "register",
]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
