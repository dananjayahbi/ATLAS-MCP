"""``get_task_details`` -- ``POST /internal/v1/task`` (Doc 08 §7.8).

Re-reads a task with the same token-trimmed projection as ``claim_next_task``
but **without** leasing.  Used after a ``STALE_LEASE``, after a review
rejection, or to re-check the DoD before submitting.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Callable

from pydantic import BaseModel, ConfigDict, Field

from ..client import TASK_PATH
from ..projections import project_task_detail
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.detail")

NAME = "get_task_details"
DESCRIPTION = (
    "Re-reads a task with the same token-trimmed projection as claim_next_task without "
    "leasing it. Use after a stale lease or a review rejection."
)

DETAIL_PARAMS: dict = {
    "type": "object",
    "properties": {"task_id": {"type": "string"}},
    "required": ["task_id"],
}

DETAIL_RETURNS: dict = {
    "type": "object",
    "required": ["task_id", "title", "status", "definition_of_done"],
    "properties": {
        "task_id": {"type": "string"},
        "title": {"type": "string"},
        "description": {"type": "string", "maxLength": 8000},
        "priority": {"type": "integer"},
        "status": {
            "type": "string",
            "enum": [
                "PENDING_APPROVAL",
                "PENDING",
                "IN_PROGRESS",
                "IN_REVIEW",
                "COMPLETED",
                "REJECTED",
            ],
        },
        "local_repo_path": {"type": "string"},
        "project_rules": {"type": "string", "maxLength": 1200},
        "definition_of_done": {"type": "array", "maxItems": 40, "items": {"type": "object"}},
        "attached_images": {"type": "array", "maxItems": 10, "items": {"type": "string"}},
        "review_notes": {"type": "string", "maxLength": 2000},
        "attempt_count": {"type": "integer"},
    },
}


class TaskDetailsArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: Annotated[str, Field(min_length=1, max_length=64)]


def make_handler(cfg: Any, client: Any) -> Callable[[TaskDetailsArgs], dict]:
    def handler(args: TaskDetailsArgs) -> dict:
        raw = client.post(TASK_PATH, {"task_id": args.task_id}, retries=2, tool=NAME)
        return project_task_detail(raw, long_path_prefix=cfg.long_path_prefix)

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def get_task_details(task_id: Any) -> str:
        return invoke(TaskDetailsArgs, payload(task_id=task_id), handler)

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(get_task_details)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=DETAIL_PARAMS)


__all__ = [
    "DESCRIPTION",
    "DETAIL_PARAMS",
    "DETAIL_RETURNS",
    "NAME",
    "REGISTER",
    "TaskDetailsArgs",
    "make_handler",
    "register",
]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
