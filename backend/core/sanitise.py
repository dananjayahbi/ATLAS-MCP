"""Log/ANSI sanitisation (Doc 01 §14.6)."""

from __future__ import annotations

import re

#: CSI / OSC / simple escape sequences.
_ANSI = re.compile(
    r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])"
)
#: C0 controls except \n and \t, plus C1 range.
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")

MAX_LOG_CHARS = 4000


def strip_ansi(text: str) -> str:
    return _ANSI.sub("", text)


def sanitise_log_message(text: str, *, limit: int = MAX_LOG_CHARS) -> str:
    """Strip escapes/controls, normalise newlines, clamp length."""
    if not isinstance(text, str):
        text = str(text)
    clean = _CONTROL.sub("", strip_ansi(text)).replace("\r\n", "\n").replace("\r", "\n")
    clean = clean.strip()
    if len(clean) > limit:
        clean = clean[: limit - 14].rstrip() + "…[truncated]"
    return clean
