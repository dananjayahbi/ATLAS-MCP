"""Agent-facing projections for the search and claim-limit tools.

Both are *allow-list* rebuilds in the same spirit as `projections.py`: an agent
gets only the fields it can act on. A search result is deliberately much smaller
than a claim projection — the whole point of searching first is to spend fewer
tokens than pulling the board.
"""

from __future__ import annotations

from core.models import ClaimLimitRequest, Task
from core.services.claim_limits import to_dto as claim_request_dto

#: A shortlist entry must stay tiny: an agent that lists 20 of them should spend
#: less than a single claim projection would cost.
SEARCH_TITLE_LIMIT = 200
SEARCH_REASON_LIMIT = 300
SEARCH_MAX_RESULTS = 100


def _iso(value) -> str | None:
    from core.ids import iso_z

    return iso_z(value)


def project_search_result(task: Task) -> dict:
    """One shortlist row: enough to decide *whether* to look closer, nothing more."""
    return {
        "task_id": str(task.pk),
        "title": task.title[:SEARCH_TITLE_LIMIT],
        "status": task.status,
        "priority": task.priority,
        "is_blocked": task.is_blocked(),
        "is_agent_discovered": task.is_agent_discovered,
        "dod_progress_percent": task.dod_progress_percent,
        "assigned_agent_id": task.assigned_agent_id or None,
    }


def project_search_response(
    tasks: list[Task],
    *,
    project_slug: str,
    total_matched: int,
    limit: int,
) -> dict:
    """`search_tasks` body: rows plus enough context to reason about the slice."""
    return {
        "project_slug": project_slug,
        "count": len(tasks),
        "total_matched": total_matched,
        "limit": limit,
        "truncated": total_matched > len(tasks),
        "items": [project_search_result(task) for task in tasks],
    }


def project_claim_request(row: ClaimLimitRequest) -> dict:
    """`request_claim_limit` body: the ask plus what happens next."""
    dto = claim_request_dto(row)
    return {
        "ok": True,
        "request_id": dto["id"],
        "status": dto["status"],
        "current_limit": dto["current_limit"],
        "requested_limit": dto["requested_limit"],
        "note": (
            "The operator must approve this request; the limit cannot be raised by an agent. "
            "Do not retry claims while the request is pending."
        ),
    }
