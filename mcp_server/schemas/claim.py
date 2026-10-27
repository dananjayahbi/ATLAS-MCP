"""``claim_next_task`` -- core, frozen (Doc 01 §9.2).

Parameters are copied verbatim from Doc 01: only three keys exist, and
``min_priority`` defaults to ``0``.  The returned projection is capped at 16 kB
by :mod:`mcp_server.projections`.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

#: JSON Schema of the parameters, verbatim from Doc 01 §9.2.
CLAIM_PARAMS: dict = {
    "type": "object",
    "required": ["project_slug", "agent_identifier"],
    "properties": {
        "project_slug": {"type": "string"},
        "agent_identifier": {"type": "string"},
        "min_priority": {"type": "integer", "minimum": 0, "maximum": 100, "default": 0},
    },
}

#: JSON Schema of the projection, from Doc 08 §7.1.
CLAIM_RETURNS: dict = {
    "type": "object",
    "properties": {
        "task_id": {"type": ["string", "null"]},
        "title": {"type": "string", "maxLength": 200},
        "description": {"type": "string", "maxLength": 8000},
        "priority": {"type": "integer", "minimum": 0, "maximum": 100},
        "status": {"type": "string", "enum": ["IN_PROGRESS"]},
        "local_repo_path": {"type": "string"},
        "project_rules": {"type": "string", "maxLength": 1200},
        "lease_id": {"type": "string"},
        "lease_ttl_seconds": {"type": "integer"},
        "heartbeat_interval_seconds": {"type": "integer"},
        "definition_of_done": {
            "type": "array",
            "maxItems": 40,
            "items": {
                "type": "object",
                "required": ["id", "label", "completed"],
                "properties": {
                    "id": {"type": "integer"},
                    "label": {"type": "string", "maxLength": 200},
                    "completed": {"type": "boolean"},
                },
            },
        },
        "attached_images": {"type": "array", "maxItems": 10, "items": {"type": "string"}},
        "reason": {"type": "string", "enum": ["NO_ELIGIBLE_TASK"]},
    },
}


class ClaimNextTaskArgs(BaseModel):
    """Validated arguments for ``claim_next_task``."""

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
    agent_identifier: Annotated[
        str,
        Field(
            min_length=3,
            max_length=64,
            pattern=r"^[A-Za-z][A-Za-z0-9._-]{2,63}$",
            description="Stable agent identity, e.g. 'Agent-Claude'",
        ),
    ]
    min_priority: Annotated[
        int,
        Field(ge=0, le=100, description="Skip tasks below this priority"),
    ] = 0


class DodItem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Annotated[int, Field(ge=1)]
    label: Annotated[str, Field(max_length=200)]
    completed: bool


class ClaimedTaskProjection(BaseModel):
    """The projected claim result. ``reason`` is only present on the empty case."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: str | None
    title: Annotated[str, Field(max_length=200)] = ""
    description: Annotated[str, Field(max_length=8000)] = ""
    priority: Annotated[int, Field(ge=0, le=100)] = 0
    status: Literal["IN_PROGRESS"] = "IN_PROGRESS"
    local_repo_path: str = ""
    project_rules: Annotated[str, Field(max_length=1200)] | None = None
    lease_id: str = ""
    lease_ttl_seconds: int = 900
    heartbeat_interval_seconds: int = 120
    definition_of_done: Annotated[list[DodItem], Field(max_length=40)] = []
    attached_images: Annotated[list[str], Field(max_length=10)] = []
    reason: Literal["NO_ELIGIBLE_TASK"] | None = None

    def as_body(self) -> dict:
        """Drop the omitted-but-None keys so the wire shape stays exact."""
        body = self.model_dump(exclude_none=True)
        if self.task_id is None:
            return {"task_id": None, "reason": self.reason or "NO_ELIGIBLE_TASK"}
        return body
