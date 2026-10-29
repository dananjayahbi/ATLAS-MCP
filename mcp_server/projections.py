"""Token projection engine (Doc 08 §8, Doc 01 §9.6).

Projections are **allow-list rebuilds**, not deletions: only the keys named in
the projection table are copied, so a newly added backend field can never leak
into an agent's context.  Every function here is pure -- dict in, dict out, no
I/O, no environment reads, no randomness -- and idempotent, because
``project(project(x)) == project(x)``.

Two ceilings exist and they are deliberately different:

``enforce_ceiling``
    Strict: raises :class:`~mcp_server.errors.ProjectionTooLarge` above 16 kB.
    Used by the small projections, where an overflow means an adapter defect.

``fit_ceiling``
    Deterministic shrink -- ``description``, then ``attached_images`` (oldest
    first), then ``project_rules`` -- and only *then* raises.  A worst-case claim
    (8 000-char description + 1 200-char rules + 40 DoD items + 10 long image
    paths) genuinely cannot fit in 16 kB, so refusing to shrink would make a
    legal task unusable.  DoD items are never dropped: they are the work
    contract.  Every shrink leaves the visible ``…[truncated]`` suffix, so the
    agent always knows it is reading a partial value -- the loss is signalled,
    never silent.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .errors import PathOutOfScope, ProjectionTooLarge
from .paths import from_posix_relative, normalize_path

# --- limits (Doc 01 §9.6) -------------------------------------------------

MAX_RESPONSE_BYTES = 16 * 1024  # 16 384

TITLE_LIMIT = 200
DESCRIPTION_LIMIT = 8000
RULES_LIMIT = 1200
REVIEW_NOTES_LIMIT = 2000
SUMMARY_LIMIT = 4000
PATCH_LIMIT = 5_242_880  # 5 MB
VERIFICATION_LOG_LIMIT = 65_536
MESSAGE_LIMIT = 4000

MAX_DOD_ITEMS = 40
MAX_IMAGES = 10

MIN_DESCRIPTION_LIMIT = 512

ELLIPSIS = "…[truncated]"

IMAGE_KINDS = frozenset({"INPUT_SCREENSHOT", "ANNOTATED_CANVAS", "VERIFICATION_IMAGE"})

TASK_STATUSES = (
    "PENDING_APPROVAL",
    "PENDING",
    "IN_PROGRESS",
    "IN_REVIEW",
    "COMPLETED",
    "REJECTED",
)


# --- primitives -----------------------------------------------------------


def truncate(value: str | None, limit: int, suffix: str = ELLIPSIS) -> str:
    """Hard-cut on a character boundary; the suffix counts INSIDE the limit (R1)."""
    if not value:
        return ""
    text = str(value)
    if len(text) <= limit:
        return text
    if limit <= 0:
        return ""
    if limit <= len(suffix):
        return suffix[:limit]
    cut = text[: limit - len(suffix)]
    # Never leave a dangling backslash before the suffix (Windows paths).
    if cut.endswith("\\") and len(cut) > 1:
        cut = cut[:-1]
    return cut + suffix


def clamp_int(value: Any, lo: int, hi: int, default: int = 0) -> int:
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return default


def take(items: Iterable[Any] | None, limit: int) -> list[Any]:
    if not items:
        return []
    return list(items)[:limit]


def compact_dumps(payload: Any) -> str:
    """The exact serialisation the MCP frame carries (§8.4 measurement)."""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def json_bytes(payload: Any) -> int:
    return len(compact_dumps(payload).encode("utf-8"))


# --- ceiling --------------------------------------------------------------


def enforce_ceiling(payload: dict, *, tool: str, limit: int = MAX_RESPONSE_BYTES) -> dict:
    """Strict ceiling: exactly ``limit`` bytes passes, one more raises."""
    size = json_bytes(payload)
    if size <= limit:
        return payload
    raise ProjectionTooLarge(tool=tool, byte_size=size, limit=limit)


def fit_ceiling(
    payload: dict,
    *,
    tool: str,
    description_source: str | None = None,
    rules_source: str | None = None,
    limit: int = MAX_RESPONSE_BYTES,
) -> dict:
    """Shrink description -> oldest images -> rules until the payload fits.

    Every shrink is *signalled*: the value keeps its ``…[truncated]`` suffix, so
    the agent always knows it is reading a partial field.  DoD items are never
    dropped (§8.4) -- they are the work contract.

    A binary search rather than a subtracting loop, because overshooting would
    discard far more description than the ceiling requires.
    """
    size = json_bytes(payload)
    if size <= limit:
        return payload

    out = dict(payload)

    # 1. description: shrink to the largest limit that fits, floor at MIN_DESCRIPTION_LIMIT.
    description = out.get("description") or ""
    source = description_source if description_source is not None else description
    lo, hi = min(MIN_DESCRIPTION_LIMIT, len(source)), len(source)
    best: str | None = None
    while lo <= hi:
        mid = (lo + hi) // 2
        candidate = truncate(source, mid)
        out["description"] = candidate
        if json_bytes(out) <= limit:
            best = candidate
            lo = mid + 1
        else:
            hi = mid - 1
    if best is not None:
        out["description"] = best
        return out
    out["description"] = truncate(source, min(MIN_DESCRIPTION_LIMIT, len(source)))
    size = json_bytes(out)
    if size <= limit:
        return out

    # 2. attached_images: drop the oldest first (R5 keeps the most recent at the tail).
    images = list(out.get("attached_images") or [])
    while size > limit and images:
        images.pop(0)
        out["attached_images"] = images
        size = json_bytes(out)
    if size <= limit:
        return out

    # 3. project_rules: shrink, then drop only as a last resort.
    rules = out.get("project_rules")
    if rules is not None:
        rules_text = rules_source if rules_source is not None else str(rules)
        lo, hi = min(64, len(rules_text)), len(rules_text)
        best_rules: str | None = None
        while lo <= hi:
            mid = (lo + hi) // 2
            out["project_rules"] = truncate(rules_text, mid)
            if json_bytes(out) <= limit:
                best_rules = out["project_rules"]
                lo = mid + 1
            else:
                hi = mid - 1
        if best_rules is not None:
            out["project_rules"] = best_rules
            return out
        out.pop("project_rules", None)
        size = json_bytes(out)

    if size > limit:
        raise ProjectionTooLarge(tool=tool, byte_size=size, limit=limit)
    return out


# --- shared field builders ------------------------------------------------


def _project_status(raw: Any, default: str) -> str:
    value = raw if isinstance(raw, str) else default
    return value if value in TASK_STATUSES else default


def _project_dod(raw: Any) -> list[dict]:
    items: list[dict] = []
    for item in take(raw if isinstance(raw, Sequence) else None, MAX_DOD_ITEMS):
        if not isinstance(item, Mapping) or item.get("id") is None:
            continue
        items.append(
            {
                "id": clamp_int(item.get("id"), 1, 100_000, 1),
                "label": truncate(item.get("label"), TITLE_LIMIT),
                "completed": bool(item.get("completed")),
            }
        )
    items.sort(key=lambda node: node["id"])  # R6: never re-sort by completed
    return items


def _image_paths(raw: Mapping[str, Any], *, long_path_prefix: bool = False, storage_root: str | None = None) -> list[str]:
    """Collect image paths, preferring ``assets[]`` and falling back to a flat list.

    Django composes absolute paths (N3); if a response ever carries a
    storage-relative path instead, it is derived against ``ATLAS_STORAGE_ROOT``
    and containment-checked, never trusted as-is.
    """
    paths: list[str] = []
    assets = raw.get("assets")
    if isinstance(assets, Sequence) and not isinstance(assets, (str, bytes)):
        for asset in assets:
            if not isinstance(asset, Mapping):
                continue
            if asset.get("kind") not in IMAGE_KINDS:
                continue
            candidate = (
                asset.get("absolute_path")
                or asset.get("path")
                or asset.get("relative_path")
            )
            if isinstance(candidate, str) and candidate:
                paths.append(_absolutise(candidate, storage_root))
    if not paths:
        flat = raw.get("attached_images")
        if isinstance(flat, Sequence) and not isinstance(flat, (str, bytes)):
            paths = [_absolutise(p, storage_root) for p in flat if isinstance(p, str) and p]
    # R5: ordered oldest -> newest by source order; keep the most recent 10.
    keep = [p for p in take(paths, MAX_IMAGES) if p]
    return [normalize_path(p, long_prefix=long_path_prefix) for p in keep]


def _absolutise(path: str, storage_root: str | None) -> str:
    """Absolute native path for an asset reference, never trusting a relative input."""
    if not path:
        return ""
    if Path(path).is_absolute():
        return normalize_path(path)
    if not storage_root:
        return normalize_path(path)
    try:
        return from_posix_relative(path, storage_root)
    except PathOutOfScope:
        return ""


# --- claim / detail -------------------------------------------------------


def project_claimed_task(
    detail_dict: Mapping[str, Any] | None,
    now: Any = None,
    *,
    lease_ttl_default: int = 900,
    heartbeat_interval_default: int = 120,
    long_path_prefix: bool = False,
    storage_root: str | None = None,
) -> dict:
    """Project a raw ``/internal/v1/claim`` body into ``ClaimedTaskProjection``.

    Pure: no I/O, no clock.  ``now`` is accepted for signature stability (the
    caller owns the clock) and deliberately not read into the output --
    projections carry no timestamps and stay byte-stable for the same input
    (§8.7).
    """
    del now  # determinism: no clock, no counters, no hashes (R3)

    raw: Mapping[str, Any] = detail_dict or {}
    if raw.get("task_id") is None:
        reason = str(raw.get("reason") or "NO_ELIGIBLE_TASK")
        if reason == "CLAIM_LIMIT_REACHED":
            # The agent needs the numbers and the remedy, not just a code: this
            # is the one empty claim it can act on (by asking the operator).
            return {
                "task_id": None,
                "reason": reason,
                "claim_limit": clamp_int(raw.get("claim_limit"), 0, 50, 0),
                "in_progress": clamp_int(raw.get("in_progress"), 0, 1000, 0),
                "hint": truncate(raw.get("hint"), RULES_LIMIT),
            }
        return {"task_id": None, "reason": reason}

    rules_source = raw.get("project_rules")
    description_source = raw.get("description")

    out: dict[str, Any] = {
        "task_id": str(raw.get("task_id")),
        "title": truncate(raw.get("title"), TITLE_LIMIT),
        "description": truncate(description_source, DESCRIPTION_LIMIT),
        "priority": clamp_int(raw.get("priority"), 0, 100, 50),
        "status": _project_status(raw.get("status"), "IN_PROGRESS"),
        "local_repo_path": normalize_path(raw.get("local_repo_path"), long_prefix=long_path_prefix),
        "lease_id": str(raw.get("lease_id") or ""),
        "lease_ttl_seconds": clamp_int(raw.get("lease_ttl_seconds"), 1, 86_400, lease_ttl_default),
        "heartbeat_interval_seconds": clamp_int(
            raw.get("heartbeat_interval_seconds"), 10, 3600, heartbeat_interval_default
        ),
        "definition_of_done": _project_dod(raw.get("definition_of_done")),
        "attached_images": _image_paths(
            raw, long_path_prefix=long_path_prefix, storage_root=storage_root
        ),
    }

    rules = truncate(rules_source, RULES_LIMIT)
    if rules:
        out["project_rules"] = rules  # omit rather than send "" (§8.2)

    return fit_ceiling(
        out,
        tool="claim_next_task",
        description_source=str(description_source) if description_source else None,
        rules_source=str(rules_source) if rules_source else None,
    )


def project_task_detail(
    detail_dict: Mapping[str, Any] | None,
    now: Any = None,
    *,
    long_path_prefix: bool = False,
    storage_root: str | None = None,
) -> dict:
    """Project a raw ``/internal/v1/task`` body: claim minus lease, plus review data."""
    raw: Mapping[str, Any] = detail_dict or {}
    if raw.get("task_id") is None:
        return {"task_id": None, "reason": str(raw.get("reason") or "NO_ELIGIBLE_TASK")}

    rules_source = raw.get("project_rules")
    description_source = raw.get("description")

    out: dict[str, Any] = {
        "task_id": str(raw.get("task_id")),
        "title": truncate(raw.get("title"), TITLE_LIMIT),
        "description": truncate(description_source, DESCRIPTION_LIMIT),
        "priority": clamp_int(raw.get("priority"), 0, 100, 50),
        "status": _project_status(raw.get("status"), "PENDING"),
        "local_repo_path": normalize_path(raw.get("local_repo_path"), long_prefix=long_path_prefix),
        "definition_of_done": _project_dod(raw.get("definition_of_done")),
        "attached_images": _image_paths(
            raw, long_path_prefix=long_path_prefix, storage_root=storage_root
        ),
        "attempt_count": clamp_int(raw.get("attempt_count"), 0, 1_000_000, 0),
    }

    rules = truncate(rules_source, RULES_LIMIT)
    if rules:
        out["project_rules"] = rules
    notes = truncate(raw.get("review_notes"), REVIEW_NOTES_LIMIT)
    if notes:
        out["review_notes"] = notes

    return fit_ceiling(
        out,
        tool="get_task_details",
        description_source=str(description_source) if description_source else None,
        rules_source=str(rules_source) if rules_source else None,
    )


# --- the six small projections --------------------------------------------


def project_propose(raw: Mapping[str, Any] | None, now: Any = None) -> dict:
    del now
    body: Mapping[str, Any] = raw or {}
    return enforce_ceiling(
        {
            "task_id": str(body.get("task_id") or ""),
            "status": "PENDING_APPROVAL",
            "ok": bool(body.get("ok", True)),
        },
        tool="propose_task",
    )


def project_submit(raw: Mapping[str, Any] | None, now: Any = None) -> dict:
    del now
    body: Mapping[str, Any] = raw or {}
    return enforce_ceiling(
        {
            "ok": bool(body.get("ok", True)),
            "status": str(body.get("status") or "IN_REVIEW"),
            "dod_progress_percent": clamp_int(body.get("dod_progress_percent"), 0, 100, 0),
        },
        tool="submit_for_review",
    )


def project_progress(raw: Mapping[str, Any] | None, now: Any = None) -> dict:
    """Exactly ``{"ok": true}`` -- two keys, no envelope (§7.4)."""
    del raw, now
    return {"ok": True}


def project_heartbeat(raw: Mapping[str, Any] | None, now: Any = None) -> dict:
    del now
    body: Mapping[str, Any] = raw or {}
    return enforce_ceiling(
        {
            "ok": bool(body.get("ok", True)),
            "lease_expires_at": str(body.get("lease_expires_at") or ""),
            "seconds_remaining": clamp_int(body.get("seconds_remaining"), 0, 86_400, 0),
        },
        tool="task_heartbeat",
    )


def project_dod(raw: Mapping[str, Any] | None, now: Any = None) -> dict:
    del now
    body: Mapping[str, Any] = raw or {}
    return enforce_ceiling(
        {
            "ok": bool(body.get("ok", True)),
            "dod_progress_percent": clamp_int(body.get("dod_progress_percent"), 0, 100, 0),
        },
        tool="update_dod_item",
    )


def project_subtask(raw: Mapping[str, Any] | None, now: Any = None) -> dict:
    del now
    body: Mapping[str, Any] = raw or {}
    return enforce_ceiling(
        {
            "ok": bool(body.get("ok", True)),
            "task_id": str(body.get("task_id") or ""),
            "status": str(body.get("status") or "PENDING"),
        },
        tool="spawn_subtask",
    )


def project_search(raw: Mapping[str, Any] | None, now: Any = None) -> dict:
    """``search_tasks`` body: a shortlist, rebuilt from the allow-list."""
    del now
    body: Mapping[str, Any] = raw or {}
    rows = body.get("items")
    items: list[dict] = []
    if isinstance(rows, list):
        for row in rows[:100]:
            if not isinstance(row, Mapping):
                continue
            items.append(
                {
                    "task_id": str(row.get("task_id") or ""),
                    "title": truncate(row.get("title"), TITLE_LIMIT),
                    "status": str(row.get("status") or ""),
                    "priority": clamp_int(row.get("priority"), 0, 100, 0),
                    "is_blocked": bool(row.get("is_blocked")),
                    "is_agent_discovered": bool(row.get("is_agent_discovered")),
                    "dod_progress_percent": clamp_int(
                        row.get("dod_progress_percent"), 0, 100, 0
                    ),
                    "assigned_agent_id": (
                        str(row["assigned_agent_id"]) if row.get("assigned_agent_id") else None
                    ),
                }
            )
    count = len(items)
    total = clamp_int(body.get("total_matched"), 0, 100_000, count)
    return enforce_ceiling(
        {
            "project_slug": str(body.get("project_slug") or ""),
            "count": count,
            "total_matched": max(total, count),
            "limit": clamp_int(body.get("limit"), 1, 100, 20),
            "truncated": bool(body.get("truncated", total > count)),
            "items": items,
        },
        tool="search_tasks",
    )


def project_claim_limit(raw: Mapping[str, Any] | None, now: Any = None) -> dict:
    """``request_claim_limit`` body: the ask, plus what the agent does next."""
    del now
    body: Mapping[str, Any] = raw or {}
    return enforce_ceiling(
        {
            "ok": bool(body.get("ok", True)),
            "request_id": str(body.get("request_id") or ""),
            "status": str(body.get("status") or "PENDING"),
            "current_limit": clamp_int(body.get("current_limit"), 0, 50, 0),
            "requested_limit": clamp_int(body.get("requested_limit"), 1, 50, 1),
            "note": truncate(body.get("note"), REVIEW_NOTES_LIMIT),
        },
        tool="request_claim_limit",
    )


#: Registry used by the tools to look up their projection by tool name.
PROJECTIONS = {
    "claim_next_task": project_claimed_task,
    "propose_task": project_propose,
    "submit_for_review": project_submit,
    "log_task_progress": project_progress,
    "task_heartbeat": project_heartbeat,
    "update_dod_item": project_dod,
    "spawn_subtask": project_subtask,
    "get_task_details": project_task_detail,
    "search_tasks": project_search,
    "request_claim_limit": project_claim_limit,
}

__all__ = [
    "ELLIPSIS",
    "MAX_RESPONSE_BYTES",
    "PROJECTIONS",
    "clamp_int",
    "compact_dumps",
    "enforce_ceiling",
    "fit_ceiling",
    "json_bytes",
    "project_claim_limit",
    "project_claimed_task",
    "project_dod",
    "project_heartbeat",
    "project_progress",
    "project_propose",
    "project_search",
    "project_submit",
    "project_subtask",
    "project_task_detail",
    "take",
    "truncate",
]
