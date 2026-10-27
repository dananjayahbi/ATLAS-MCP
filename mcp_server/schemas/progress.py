"""``log_task_progress`` -- core, frozen (Doc 01 §9.5).

The result is exactly ``{"ok": true}``: no line number, no timestamp, no byte
count.  The most frequently called tool in the protocol must not tax agent
context (§7.4).  ``message`` over 4 000 chars is truncated *before* sending and
still succeeds; ANSI escapes and control characters are stripped locally so the
HUD never receives an injection vector (Doc 01 §14.6).
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..projections import ELLIPSIS, MESSAGE_LIMIT

LOG_LEVELS = ("DEBUG", "INFO", "WARN", "ERROR")

_LOG_LEVEL_PATTERN = r"^(DEBUG|INFO|WARN|ERROR)$"

#: JSON Schema of the parameters, verbatim from Doc 08 §7.4.
PROGRESS_PARAMS: dict = {
    "type": "object",
    "properties": {
        "task_id": {"type": "string"},
        "message": {"type": "string", "maxLength": MESSAGE_LIMIT},
        "level": {"type": "string", "enum": list(LOG_LEVELS), "default": "INFO"},
    },
    "required": ["task_id", "message"],
}

#: Exactly two fields, nothing else (§7.4).
PROGRESS_RETURNS: dict = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
}

#: CSI / OSC / single-character escape sequences plus C0/C1 control characters.
_ANSI_RE = re.compile(
    r"""
    \x1B \[ [0-?]* [ -/]* [@-~]      # CSI ... final byte
  | \x1B \] .*? (?:\x07|\x1B\\)      # OSC ... BEL or ST
  | \x1B [@-Z\\-_]                   # two-character escapes
  | [\x00-\x08\x0B\x0C\x0E-\x1F\x7F] # C0 controls except \t \n \r
  | \x9B [0-?]* [ -/]* [@-~]         # 8-bit CSI
    """,
    re.VERBOSE | re.DOTALL,
)

_TRUNCATION_SUFFIX = ELLIPSIS


def strip_control(value: str) -> str:
    """Remove ANSI sequences and control characters, keep tabs and newlines."""
    if not value:
        return ""
    cleaned = _ANSI_RE.sub("", value)
    # Normalise CRLF so a HUD terminal never re-renders a line in place.
    return cleaned.replace("\r\n", "\n").replace("\r", "\n")


class LogTaskProgressArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    task_id: Annotated[str, Field(min_length=1, max_length=64)]
    message: Annotated[str, Field(min_length=1, max_length=MESSAGE_LIMIT)]
    level: Annotated[str, Field(pattern=_LOG_LEVEL_PATTERN)] = "INFO"

    @field_validator("message")
    @classmethod
    def _sanitize(cls, value: str) -> str:
        cleaned = strip_control(value)
        if len(cleaned) > MESSAGE_LIMIT:
            cleaned = cleaned[: MESSAGE_LIMIT - len(_TRUNCATION_SUFFIX)] + _TRUNCATION_SUFFIX
        return cleaned or "[empty after control-character strip]"

    @field_validator("level")
    @classmethod
    def _upper(cls, value: str) -> str:
        upper = value.upper()
        if upper not in LOG_LEVELS:
            # Never silently coerce an unknown level (§7.4).
            raise ValueError(f"level must be one of {', '.join(LOG_LEVELS)}")
        return upper


class LogTaskProgressResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: Literal[True] = True
