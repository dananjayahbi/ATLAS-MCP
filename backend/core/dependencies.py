"""`blocked_by` satisfaction: progress-based, not status-based.

Why the rule changed
--------------------
The original rule ("every blocker must be `COMPLETED`") deadlocked the pipeline.
An agent parks finished work in `IN_REVIEW` and only a human moves it to
`COMPLETED`, so every dependent task stayed unclaimable for that entire review
window even though the blocking *work* was demonstrably finished.

The rule is now **progress-based**: a blocker satisfies its edge as soon as its
Definition of Done reads 100 %, in whatever status the row happens to sit.
The blocker's status is irrelevant to the dependency graph; its checklist is
the acceptance contract and therefore the only thing that can be "done".

Satisfaction predicate
----------------------
    satisfied(task) := task.status == COMPLETED
                    or task.dod_progress_percent == 100

* `COMPLETED` wins outright: a human verified the work, so a legacy row whose
  checklist was never filled in still releases its dependents.
* Otherwise the checklist decides. A task with **no** checklist items reads as
  0 % (never 100 %), so "no acceptance contract" is *not* treated as "done".

`is_satisfied()` (Python) and `unsatisfied_blocker_qs()` (SQL) must stay
equivalent. They do, because `dod_progress_percent` can only round up to 100
when every item is ticked — the checklist is capped at 50 items, and
`round(49 / 50 * 100) == 98`.
"""

from __future__ import annotations

from django.db.models import Count, F, Q, QuerySet

from core.enums import TaskStatus

__all__ = [
    "is_satisfied",
    "is_blocked",
    "unsatisfied_blocker_qs",
    "unsatisfied_blocker_ids",
]


def is_satisfied(task) -> bool:
    """True when `task` releases the tasks that list it in `blocked_by`."""
    if task is None:
        return False
    if task.status == TaskStatus.COMPLETED:
        return True
    return task.dod_progress_percent == 100


def unsatisfied_blocker_qs() -> QuerySet:
    """Every task that does **not** satisfy a `blocked_by` edge.

    Used as an `IN` subquery so a board/queue/claim scan stays one round trip:

        Task.objects.exclude(blocked_by__in=unsatisfied_blocker_qs())

    Deliberately not project-scoped: `blocked_by` is a plain M2M and nothing
    stops an operator wiring a cross-project edge, so filtering by project here
    would silently drop those blockers from the scan.
    """
    from core.models import Task

    return (
        Task.objects.exclude(status=TaskStatus.COMPLETED)
        .annotate(
            _dep_total=Count("checklist", distinct=True),
            _dep_done=Count(
                "checklist", filter=Q(checklist__completed=True), distinct=True
            ),
        )
        .filter(Q(_dep_total=0) | Q(_dep_done__lt=F("_dep_total")))
    )


def unsatisfied_blocker_ids(task) -> list[str]:
    """Ids of `task`'s blockers that have not reached 100 % DoD yet."""
    return [str(b.pk) for b in task.blocked_by.all() if not is_satisfied(b)]


def is_blocked(task) -> bool:
    """True when at least one `blocked_by` edge is still unsatisfied.

    Prefetch-aware: `task.blocked_by.all()` is served from the prefetch cache
    when the caller used `with_detail()` / `prefetch_related("blocked_by")`.
    """
    return any(not is_satisfied(b) for b in task.blocked_by.all())
