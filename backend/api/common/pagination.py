"""Cursor pagination: opaque base64 of `(created_at, id)` (Doc 01 §7.1)."""

from __future__ import annotations

import base64
import binascii
import json
from typing import Any

from core.errors import ValidationError

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def encode_cursor(created_at, obj_id, field: str | None = None) -> str:
    payload: dict[str, Any] = {"t": str(created_at), "i": str(obj_id)}
    if field:
        payload["f"] = field
    raw = json.dumps(payload, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def decode_cursor(cursor: str | None) -> tuple[str, str, str | None] | None:
    """Return `(sort_value, pk, sort_field)`; `sort_field` is absent on old cursors."""
    if not cursor:
        return None
    padded = cursor + "=" * (-len(cursor) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        return str(payload["t"]), str(payload["i"]), payload.get("f")
    except (binascii.Error, ValueError, KeyError, TypeError):
        raise ValidationError("Malformed pagination cursor.", detail={"cursor": cursor}) from None


def resolve_page_size(raw: Any, default: int = DEFAULT_PAGE_SIZE) -> int:
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError("limit must be an integer.", detail={"field": "limit"}) from None
    if value < 1:
        raise ValidationError("limit must be ≥ 1.", detail={"field": "limit"})
    return min(value, MAX_PAGE_SIZE)
