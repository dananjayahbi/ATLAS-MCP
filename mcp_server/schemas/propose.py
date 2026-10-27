"""``propose_task`` -- core, frozen (Doc 01 §9.3).

``screenshot_paths`` are host-absolute paths; they are containment-checked
against ``ATLAS_STORAGE_ROOT`` **before** any HTTP call so an escape costs zero
bytes (§9.3, I-7).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

#: JSON Schema of the parameters, verbatim from Doc 08 §7.2.
PROPOSE_PARAMS: dict = {
    "type": "object",
    "properties": {
        "project_slug": {"type": "string"},
        "title": {"type": "string", "maxLength": 200},
        "description": {"type": "string", "maxLength": 8000},
        "suggested_priority": {"type": "integer", "minimum": 0, "maximum": 100},
        "discovered_during_task_id": {"type": "string"},
        "screenshot_paths": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
    },
    "required": [
        "project_slug",
        "title",
        "description",
        "suggested_priority",
        "discovered_during_task_id",
    ],
}

PROPOSE_RETURNS: dict = {
    "type": "object",
    "properties": {
        "task_id": {"type": "string"},
        "status": {"type": "string", "enum": ["PENDING_APPROVAL"]},
        "ok": {"type": "boolean"},
    },
    "required": ["task_id", "status", "ok"],
}

MAX_SCREENSHOTS = 5


class ProposeTaskArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    project_slug: Annotated[
        str,
        Field(min_length=2, max_length=32, pattern=r"^[a-z][a-z0-9-]{1,31}$"),
    ]
    title: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(min_length=1, max_length=8000)]
    suggested_priority: Annotated[int, Field(ge=0, le=100)]
    discovered_during_task_id: Annotated[str, Field(min_length=1, max_length=64)]
    screenshot_paths: Annotated[list[str], Field(max_length=MAX_SCREENSHOTS)] | None = None


class ProposeTaskResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: str
    status: Literal["PENDING_APPROVAL"] = "PENDING_APPROVAL"
    ok: bool = True
