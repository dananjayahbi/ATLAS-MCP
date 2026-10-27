"""Shared computed-field helpers (Doc 04 §4.1).

These exist so the serializers stay declarative and the arithmetic lives in one
place that unit tests can call directly.
"""

from __future__ import annotations

from datetime import datetime

from core.ids import iso_z, utcnow


def age_hours(created_at: datetime | None, now: datetime | None = None) -> float:
    if created_at is None:
        return 0.0
    reference = now or utcnow()
    return round((reference - created_at).total_seconds() / 3600, 2)


def dod_progress(completed: int, total: int) -> int:
    if not total:
        return 0
    return round(completed / total * 100)


def dependency_weight(blocker_count: int, child_count: int) -> float:
    return round(blocker_count + 0.5 * child_count, 2)


def lease_seconds_remaining(lease_expires_at: datetime | None, now: datetime | None = None) -> int | None:
    if lease_expires_at is None:
        return None
    delta = lease_expires_at - (now or utcnow())
    return max(0, int(delta.total_seconds()))


def iso(value: datetime | None) -> str | None:
    return iso_z(value)
