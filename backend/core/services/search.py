"""Task search shared by the operator list and the agent search tool.

The board already filters tasks over HTTP, but an agent has no board: it needs a
way to say "show me the pending POS-terminal work" before it claims anything,
otherwise it either claims blind or pulls the whole project into its context.

Two entry points, one filter vocabulary:

* :func:`search_tasks` — the query used by `/internal/v1/tasks/search`.
* :func:`apply_task_filters` — the same predicates over a `QuerySet`, reused by
  the operator list view so both surfaces cannot drift.
"""

from __future__ import annotations

from typing import Iterable

from django.db.models import Q, QuerySet

from core.errors import ValidationError
from core.models import Task

#: Statuses an agent may search. `PENDING_APPROVAL` is included because
#: discovering near-duplicate proposals is a legitimate reason to search.
SEARCHABLE_STATUSES = (
    "PENDING_APPROVAL",
    "PENDING",
    "IN_PROGRESS",
    "IN_REVIEW",
    "COMPLETED",
    "REJECTED",
)

#: Largest page an agent may request. Agent contexts are the scarce resource the
#: search exists to protect, so a huge `limit` would defeat the purpose.
MAX_SEARCH_LIMIT = 100


def _clean_text(value: str | None, field: str, *, max_len: int = 200) -> str:
    text = (value or "").strip()
    if len(text) > max_len:
        raise ValidationError(
            f"{field} exceeds {max_len} characters.",
            detail={"field": field, "max_len": max_len},
        )
    return text


def parse_statuses(raw: Iterable[str] | str | None) -> list[str]:
    """Accept `IT, comma-separated` strings and lists; validate every value."""
    if raw is None:
        return []
    parts: list[str] = []
    values = [raw] if isinstance(raw, str) else list(raw)
    for value in values:
        for part in str(value).split(","):
            cleaned = part.strip().upper()
            if cleaned and cleaned not in parts:
                parts.append(cleaned)
    unknown = [value for value in parts if value not in SEARCHABLE_STATUSES]
    if unknown:
        raise ValidationError(
            f"Unknown status: {', '.join(unknown)}.",
            detail={"field": "status", "allowed": list(SEARCHABLE_STATUSES)},
        )
    return parts


def apply_task_filters(
    qs: QuerySet,
    *,
    query: str | None = None,
    statuses: Iterable[str] | str | None = None,
    priority_min: int | None = None,
    priority_max: int | None = None,
    agent: str | None = None,
    blocked_only: bool = False,
    include_archived: bool = False,
) -> QuerySet:
    """Apply the shared search vocabulary to `qs`.

    Raises `ValidationError` for anything the caller got wrong, so an agent gets
    a 400 it can read rather than a silently empty result.
    """
    if not include_archived:
        qs = qs.filter(archived_at__isnull=True)

    parsed = parse_statuses(statuses)
    if parsed:
        qs = qs.filter(status__in=parsed)

    text = _clean_text(query, "q", max_len=200)
    if text:
        # Word-by-word AND: "POS terminal" matches a title containing both words
        # in any order, which is how people actually describe this kind of work.
        # `icontains` already escapes `%`/`_`, so a search for "50%" stays literal.
        for word in text.split():
            qs = qs.filter(
                Q(title__icontains=word) | Q(description__icontains=word)
            )

    if priority_min is not None:
        qs = qs.filter(priority__gte=_as_priority(priority_min, "priority_min"))
    if priority_max is not None:
        qs = qs.filter(priority__lte=_as_priority(priority_max, "priority_max"))

    agent_name = _clean_text(agent, "agent", max_len=120)
    if agent_name:
        qs = qs.filter(assigned_agent_id=agent_name)

    if blocked_only:
        from django.db.models import Exists, OuterRef

        from core.enums import TaskStatus

        unsatisfied = Task.blocked_by.through.objects.filter(
            from_task_id=OuterRef("pk")
        ).exclude(to_task__status=TaskStatus.COMPLETED)
        qs = qs.annotate(_search_blocked=Exists(unsatisfied)).filter(_search_blocked=True)

    return qs


def _as_priority(value: int, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{field} must be an integer.", detail={"field": field})
    if not 0 <= value <= 100:
        raise ValidationError(
            f"{field} must be between 0 and 100.",
            detail={"field": field, "value": value},
        )
    return value


def search_tasks(
    project,
    *,
    query: str | None = None,
    statuses: Iterable[str] | str | None = None,
    priority_min: int | None = None,
    priority_max: int | None = None,
    agent: str | None = None,
    blocked_only: bool = False,
    limit: int = 20,
    sort: str = "priority",
) -> list[Task]:
    """Bounded, priority-first search inside one project.

    The default limit is deliberately small: the point of the tool is to hand
    the agent a shortlist it can act on, not a dump of the board.
    """
    if isinstance(limit, bool) or not isinstance(limit, int):
        raise ValidationError("limit must be an integer.", detail={"field": "limit"})
    if limit < 1:
        raise ValidationError("limit must be at least 1.", detail={"field": "limit"})
    limit = min(limit, MAX_SEARCH_LIMIT)

    qs = Task.objects.filter(project=project).select_related("project")
    qs = apply_task_filters(
        qs,
        query=query,
        statuses=statuses,
        priority_min=priority_min,
        priority_max=priority_max,
        agent=agent,
        blocked_only=blocked_only,
    )

    ordering = {
        "priority": ("-priority", "created_at"),
        "created": ("created_at",),
        "updated": ("-updated_at",),
    }.get(sort, ("-priority", "created_at"))
    return list(qs.order_by(*ordering)[:limit])


def get_project_for_search(slug: str):
    """Project lookup shared by the search and claim-limit routes."""
    from core.services.tasks import get_project

    return get_project(slug)


def _filtered(qs: QuerySet, **kwargs) -> QuerySet:
    return apply_task_filters(qs, **kwargs)


def count_matches(
    project,
    *,
    query: str | None = None,
    statuses: Iterable[str] | str | None = None,
    priority_min: int | None = None,
    priority_max: int | None = None,
    agent: str | None = None,
    blocked_only: bool = False,
) -> int:
    """Total rows behind a search slice, so an agent can tell breadth from page."""
    qs = Task.objects.filter(project=project)
    qs = _filtered(
        qs,
        query=query,
        statuses=statuses,
        priority_min=priority_min,
        priority_max=priority_max,
        agent=agent,
        blocked_only=blocked_only,
    )
    return qs.count()
