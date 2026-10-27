"""``spawn_subtask`` -- ``POST /internal/v1/subtask`` (Doc 08 §7.7).

Decomposes the current task when the work genuinely exceeds one lease.  The
child lands in ``PENDING`` (immediately claimable) and inherits ``parent_task_id``
with ``priority = min(parent.priority, requested)``, so a subtask can never
outrank its parent.

``retries=0``: there is no idempotency key for this route, so an automatic retry
would create a duplicate child.  The transport failure surfaces directly
(§12.2 *Decision*).
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Callable

from pydantic import BaseModel, ConfigDict, Field

from ..client import SUBTASK_PATH
from ..projections import project_subtask
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.subtask")

NAME = "spawn_subtask"
DESCRIPTION = (
    "Creates a child task when the current work exceeds a single lease. The child is "
    "immediately claimable and can never outrank its parent."
)

SUBTASK_PARAMS: dict = {
    "type": "object",
    "properties": {
        "parent_task_id": {"type": "string"},
        "title": {"type": "string", "maxLength": 200},
        "description": {"type": "string", "maxLength": 8000},
        "priority": {"type": "integer", "minimum": 0, "maximum": 100},
    },
    "required": ["parent_task_id", "title", "description", "priority"],
}

SUBTASK_RETURNS: dict = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean"},
        "task_id": {"type": "string"},
        "status": {"type": "string", "enum": ["PENDING"]},
    },
    "required": ["ok", "task_id", "status"],
}


class SpawnSubtaskArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    parent_task_id: Annotated[str, Field(min_length=1, max_length=64)]
    title: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(min_length=1, max_length=8000)]
    priority: Annotated[int, Field(ge=0, le=100)]


def make_handler(cfg: Any, client: Any) -> Callable[[SpawnSubtaskArgs], dict]:
    def handler(args: SpawnSubtaskArgs) -> dict:
        LOGGER.info(
            "subtask parent=%s priority=%s title=%s",
            args.parent_task_id,
            args.priority,
            args.title[:80],
        )
        raw = client.post(
            SUBTASK_PATH,
            {
                "parent_task_id": args.parent_task_id,
                "title": args.title,
                "description": args.description,
                "priority": args.priority,
            },
            retries=0,
            tool=NAME,
        )
        return project_subtask(raw)

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def spawn_subtask(
        parent_task_id: Any,
        title: Any,
        description: Any,
        priority: Any,
    ) -> str:
        return invoke(
            SpawnSubtaskArgs,
            payload(
                parent_task_id=parent_task_id,
                title=title,
                description=description,
                priority=priority,
            ),
            handler,
        )

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(spawn_subtask)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=SUBTASK_PARAMS)


__all__ = [
    "DESCRIPTION",
    "NAME",
    "REGISTER",
    "SUBTASK_PARAMS",
    "SUBTASK_RETURNS",
    "SpawnSubtaskArgs",
    "make_handler",
    "register",
]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
