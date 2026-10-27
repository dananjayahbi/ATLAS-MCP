"""``submit_for_review`` -- core, frozen (Doc 01 §9.4).

The 5 MB ``git_patch`` cap is pre-flighted locally so an over-sized patch fails
in microseconds instead of after a 30 s upload (§5.4 point 3).  ``isError``
stays false for business failures; only the JSON body carries the reason.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

PATCH_MAX_CHARS = 5_242_880  # 5 MB
SUMMARY_MAX_CHARS = 4000
VERIFICATION_LOG_MAX_CHARS = 65_536

#: JSON Schema of the parameters, verbatim from Doc 08 §7.3.
SUBMIT_PARAMS: dict = {
    "type": "object",
    "properties": {
        "task_id": {"type": "string"},
        "summary_of_work": {"type": "string", "maxLength": SUMMARY_MAX_CHARS},
        "git_patch": {
            "type": "string",
            "description": "Unified git diff of changes",
            "maxLength": PATCH_MAX_CHARS,
        },
        "verification_log": {
            "type": "string",
            "description": "Stdout summary of test suite pass",
            "maxLength": VERIFICATION_LOG_MAX_CHARS,
        },
    },
    "required": ["task_id", "summary_of_work", "git_patch"],
}

SUBMIT_RETURNS: dict = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean"},
        "status": {"type": "string", "enum": ["IN_REVIEW"]},
        "dod_progress_percent": {"type": "integer", "minimum": 0, "maximum": 100},
    },
    "required": ["ok", "status", "dod_progress_percent"],
}


class SubmitForReviewArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    task_id: Annotated[str, Field(min_length=1, max_length=64)]
    summary_of_work: Annotated[str, Field(min_length=1, max_length=SUMMARY_MAX_CHARS)]
    git_patch: Annotated[str, Field(min_length=1, max_length=PATCH_MAX_CHARS)]
    verification_log: Annotated[str, Field(max_length=VERIFICATION_LOG_MAX_CHARS)] | None = None

    def patch_looks_like_unified_diff(self) -> bool:
        """A unified diff must carry both ``---`` and ``+++`` markers."""
        patch = self.git_patch
        return ("---" in patch) and ("+++" in patch)


class SubmitForReviewResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool = True
    status: Literal["IN_REVIEW"] = "IN_REVIEW"
    dod_progress_percent: Annotated[int, Field(ge=0, le=100)] = 0
