"""``update_dod_item`` -- ``POST /internal/v1/dod`` (Doc 08 §7.6).

Ticks one Definition-of-Done checkbox so the HUD gauge moves live.  Absolute
``PUT`` semantics on ``(task_id, item_id) -> completed``: re-sending the current
state succeeds with ``ok: true`` and produces an identical body.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Callable

from pydantic import BaseModel, ConfigDict, Field

from ..client import DOD_PATH
from ..projections import project_dod
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.dod")

NAME = "update_dod_item"
DESCRIPTION = (
    "Marks one Definition-of-Done checklist item complete or incomplete on a claimed "
    "task, emitting a task.dod_updated event so the HUD progress gauge moves live."
)

DOD_PARAMS: dict = {
    "type": "object",
    "properties": {
        "task_id": {"type": "string"},
        "item_id": {
            "type": "integer",
            "minimum": 1,
            "description": "ChecklistItem.order_index exposed as id",
        },
        "completed": {"type": "boolean"},
    },
    "required": ["task_id", "item_id", "completed"],
}

DOD_RETURNS: dict = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean"},
        "dod_progress_percent": {"type": "integer", "minimum": 0, "maximum": 100},
    },
    "required": ["ok", "dod_progress_percent"],
}


class DodArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    task_id: Annotated[str, Field(min_length=1, max_length=64)]
    item_id: Annotated[int, Field(ge=1, le=100_000)]
    completed: bool


def make_handler(cfg: Any, client: Any) -> Callable[[DodArgs], dict]:
    def handler(args: DodArgs) -> dict:
        LOGGER.info("dod task=%s item=%s completed=%s", args.task_id, args.item_id, args.completed)
        raw = client.post(
            DOD_PATH,
            {"task_id": args.task_id, "item_id": args.item_id, "completed": args.completed},
            retries=2,
            tool=NAME,
        )
        return project_dod(raw)

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def update_dod_item(task_id: Any, item_id: Any, completed: Any) -> str:
        return invoke(
            DodArgs,
            payload(task_id=task_id, item_id=item_id, completed=completed),
            handler,
        )

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(update_dod_item)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=DOD_PARAMS)


__all__ = [
    "DESCRIPTION",
    "DOD_PARAMS",
    "DOD_RETURNS",
    "DodArgs",
    "NAME",
    "REGISTER",
    "make_handler",
    "register",
]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
