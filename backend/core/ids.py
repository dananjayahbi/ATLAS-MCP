"""Identifier helpers: UUIDs and ULIDs (Doc 01 §5)."""

from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone

# Crockford base32 — ULID alphabet (no I, L, O, U).
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(_CROCKFORD[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def ulid(prefix: str = "") -> str:
    """Generate a monotonic-ish ULID string, optionally prefixed.

    Time is 48-bit ms; randomness is 80-bit. Not strictly monotonic within a
    millisecond, which is fine: `seq` (not `id`) is the ordering key (§11.3).
    """
    ts = int(time.time() * 1000)
    randomness = int.from_bytes(os.urandom(10), "big")
    return f"{prefix}{_encode(ts, 10)}{_encode(randomness, 16)}"


def lease_id() -> str:
    return ulid("lea_")


def event_id() -> str:
    return ulid("evt_")


def request_id() -> str:
    return ulid("req_")


def project_id() -> uuid.UUID:
    return uuid.uuid4()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(value: datetime | None) -> str | None:
    """Render a datetime as `...Z` with millisecond precision (Doc 01 §5)."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    value = value.astimezone(timezone.utc)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"
