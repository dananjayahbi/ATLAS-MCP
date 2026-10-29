"""`Project` — Doc 01 §6.3."""

from __future__ import annotations

import uuid

from django.db import models

from core.enums import HEALTH_DENOMINATOR_STATUSES, TaskStatus

#: Default concurrent-claim ceiling for a new project (Doc 01 §8 T5).
DEFAULT_CLAIM_LIMIT = 5


class ProjectQuerySet(models.QuerySet):
    def active(self) -> "ProjectQuerySet":
        return self.filter(archived_at__isnull=True)


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=120)
    local_repo_path = models.CharField(max_length=1024)
    global_rules_md = models.TextField(blank=True, default="")
    accent_color = models.CharField(max_length=7, default="#00F2FE")
    #: How many tasks an agent may hold `IN_PROGRESS` in this project at once.
    #: `0` disables the ceiling. Enforced by `core.leases.claim_next_task`; an
    #: agent cannot raise it itself, it can only file a `ClaimLimitRequest`.
    claim_limit = models.PositiveSmallIntegerField(default=DEFAULT_CLAIM_LIMIT)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ProjectQuerySet.as_manager()

    class Meta:
        db_table = "core_project"
        ordering = ["slug"]

    def __str__(self) -> str:  # pragma: no cover
        return f"Project({self.slug})"

    # -- derived counters (Doc 01 §6.9) ------------------------------------
    def status_counts(self) -> dict[str, int]:
        rows = (
            self.tasks.values("status")
            .order_by()
            .annotate(total=models.Count("id"))
            .values_list("status", "total")
        )
        counts = {s.value: 0 for s in TaskStatus}
        for status, total in rows:
            counts[status] = total
        return counts

    def health_percent(self) -> int:
        counts = self.status_counts()
        completed = counts.get(TaskStatus.COMPLETED.value, 0)
        denominator = sum(counts.get(s.value, 0) for s in HEALTH_DENOMINATOR_STATUSES)
        if denominator == 0:
            return 0
        return round(completed / denominator * 100)
