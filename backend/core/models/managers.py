"""`TaskQuerySet` helpers — claim filter + aggregate-friendly loaders (Doc 02 §5.6)."""

from __future__ import annotations

from django.db import models
from django.db.models import Count, F, Q

from core.enums import TaskStatus


class TaskQuerySet(models.QuerySet):
    def for_project(self, project_id) -> "TaskQuerySet":
        return self.filter(project_id=project_id)

    def with_detail(self) -> "TaskQuerySet":
        """Prefetch everything `TaskDetailDTO` needs, in a fixed query budget."""
        return self.select_related("project").prefetch_related(
            "checklist", "assets", "blocked_by", "blocks"
        )

    def with_summary_annotations(self) -> "TaskQuerySet":
        """Annotate the derived fields so serializers never issue per-row queries."""
        return self.select_related("project").annotate(
            _dod_total=Count("checklist", distinct=True),
            _dod_done=Count("checklist", filter=Q(checklist__completed=True), distinct=True),
            _child_count=Count("children", distinct=True),
        )

    def claimable(self, *, min_priority: int = 0) -> "TaskQuerySet":
        """The claim filter (Doc 01 §8 T5).

        `is_blocked` is evaluated as one SQL subquery rather than a Python loop
        so the queue scan stays a single round trip (master §4.2). The blocker
        set is `core.dependencies.unsatisfied_blocker_qs()` — progress-based, so
        a blocker sitting in `IN_REVIEW` at 100 % DoD already releases its
        dependents.
        """
        from core.dependencies import unsatisfied_blocker_qs

        return (
            self.filter(status=TaskStatus.PENDING, priority__gte=min_priority)
            .filter(archived_at__isnull=True)
            .exclude(project__archived_at__isnull=False)
            .exclude(blocked_by__in=unsatisfied_blocker_qs())
            .order_by("-priority", "created_at")
        )

    def overdue(self) -> "TaskQuerySet":
        """In-progress tasks whose estimated deadline has already been flagged."""
        return self.filter(
            status=TaskStatus.IN_PROGRESS, lease_overdue_at__isnull=False
        )

    def in_review(self) -> "TaskQuerySet":
        return self.filter(status=TaskStatus.IN_REVIEW).order_by(F("submitted_at").asc(nulls_last=True))


class ChecklistQuerySet(models.QuerySet):
    def for_task(self, task_id) -> "ChecklistQuerySet":
        return self.filter(task_id=task_id).order_by("order_index")
