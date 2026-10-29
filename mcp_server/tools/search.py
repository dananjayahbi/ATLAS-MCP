"""``search_tasks`` -- ``POST /internal/v1/tasks/search``.

The claim tool takes one task at a time and `get_task_details` needs an id, so an
agent with a broad goal ("fix the POS terminal issues") has no way to find the
relevant rows without pulling the whole board. That is exactly the context blowup
this tool exists to prevent: it returns a shortlist of ids, and the agent still
has to claim before touching anything.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Callable

from pydantic import BaseModel, ConfigDict, Field

from ..client import TASK_SEARCH_PATH
from ..projections import project_search
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.search")

NAME = "search_tasks"
DESCRIPTION = (
    "Searches a project's tasks by text and filters (status, priority, agent, blocked) "
    "and returns a short list. Use it to find the relevant tasks before claiming; it "
    "does NOT lease anything."
)

#: Statuses the backend accepts; kept as a literal enum so the schema is honest.
TASK_STATUSES = (
    "PENDING_APPROVAL",
    "PENDING",
    "IN_PROGRESS",
    "IN_REVIEW",
    "COMPLETED",
    "REJECTED",
)

#: Default page size. Small on purpose: the shortlist must cost less than a claim.
DEFAULT_LIMIT = 20
MAX_LIMIT = 100

SEARCH_PARAMS: dict = {
    "type": "object",
    "required": ["project_slug"],
    "properties": {
        "project_slug": {"type": "string"},
        "q": {
            "type": "string",
            "maxLength": 200,
            "description": "Words to match in title or description, e.g. 'POS terminal'",
        },
        "status": {
            "type": "array",
            "items": {"type": "string", "enum": list(TASK_STATUSES)},
            "description": "Restrict to these statuses; omit for all",
        },
        "priority_min": {"type": "integer", "minimum": 0, "maximum": 100},
        "priority_max": {"type": "integer", "minimum": 0, "maximum": 100},
        "agent": {"type": "string", "maxLength": 120},
        "blocked_only": {"type": "boolean", "default": False},
        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": DEFAULT_LIMIT},
        "sort": {"type": "string", "enum": ["priority", "created", "updated"], "default": "priority"},
    },
}

SEARCH_RETURNS: dict = {
    "type": "object",
    "required": ["project_slug", "count", "items"],
    "properties": {
        "project_slug": {"type": "string"},
        "count": {"type": "integer"},
        "total_matched": {"type": "integer"},
        "limit": {"type": "integer"},
        "truncated": {"type": "boolean"},
        "items": {
            "type": "array",
            "maxItems": MAX_LIMIT,
            "items": {
                "type": "object",
                "required": ["task_id", "title", "status", "priority"],
                "properties": {
                    "task_id": {"type": "string"},
                    "title": {"type": "string", "maxLength": 200},
                    "status": {"type": "string", "enum": list(TASK_STATUSES)},
                    "priority": {"type": "integer"},
                    "is_blocked": {"type": "boolean"},
                    "is_agent_discovered": {"type": "boolean"},
                    "dod_progress_percent": {"type": "integer"},
                    "assigned_agent_id": {"type": ["string", "null"]},
                },
            },
        },
    },
}


class SearchTasksArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    project_slug: Annotated[
        str,
        Field(
            min_length=2,
            max_length=32,
            pattern=r"^[a-z][a-z0-9-]{1,31}$",
            description="Project slug, e.g. 'alpha'",
        ),
    ]
    q: Annotated[
        str | None,
        Field(max_length=200, description="Words to match in title or description"),
    ] = None
    status: Annotated[
        list[Annotated[str, Field(pattern=r"^(PENDING_APPROVAL|PENDING|IN_PROGRESS|IN_REVIEW|COMPLETED|REJECTED)$")]] | None,
        Field(max_length=6, description="Restrict to these statuses"),
    ] = None
    priority_min: Annotated[int | None, Field(ge=0, le=100)] = None
    priority_max: Annotated[int | None, Field(ge=0, le=100)] = None
    agent: Annotated[str | None, Field(max_length=120)] = None
    blocked_only: bool = False
    limit: Annotated[int, Field(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT
    sort: Annotated[str, Field(pattern=r"^(priority|created|updated)$")] = "priority"


def make_handler(cfg: Any, client: Any) -> Callable[[SearchTasksArgs], dict]:
    def handler(args: SearchTasksArgs) -> dict:
        body: dict[str, Any] = {
            "project_slug": args.project_slug,
            "limit": args.limit,
            "sort": args.sort,
            "blocked_only": args.blocked_only,
        }
        if args.q:
            body["q"] = args.q
        if args.status:
            body["status"] = ",".join(args.status)
        if args.priority_min is not None:
            body["priority_min"] = args.priority_min
        if args.priority_max is not None:
            body["priority_max"] = args.priority_max
        if args.agent:
            body["agent"] = args.agent

        LOGGER.info(
            "search project=%s q=%s status=%s limit=%d",
            args.project_slug,
            args.q or "",
            ",".join(args.status or []),
            args.limit,
        )
        raw = client.post(TASK_SEARCH_PATH, body, retries=2, tool=NAME)
        return project_search(raw)

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def search_tasks(
        project_slug: Any,
        q: Any = None,
        status: Any = None,
        priority_min: Any = None,
        priority_max: Any = None,
        agent: Any = None,
        blocked_only: Any = None,
        limit: Any = None,
        sort: Any = None,
    ) -> str:
        return invoke(
            SearchTasksArgs,
            payload(
                project_slug=project_slug,
                q=q,
                status=status,
                priority_min=priority_min,
                priority_max=priority_max,
                agent=agent,
                blocked_only=blocked_only,
                limit=limit,
                sort=sort,
            ),
            handler,
        )

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(search_tasks)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=SEARCH_PARAMS)


__all__ = [
    "DEFAULT_LIMIT",
    "DESCRIPTION",
    "MAX_LIMIT",
    "NAME",
    "REGISTER",
    "SEARCH_PARAMS",
    "SEARCH_RETURNS",
    "SearchTasksArgs",
    "make_handler",
    "register",
]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
