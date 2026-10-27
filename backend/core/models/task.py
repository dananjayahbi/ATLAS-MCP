"""`Task` — Doc 01 §6.4."""

from __future__ import annotations

import uuid

from django.db import models

from core.enums import TaskStatus
from core.models.managers import TaskQuerySet


class Task(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "core.Project", on_delete=models.CASCADE, related_name="tasks"
    )
    title = models.CharField(max_length=200)
    description = models.TextField()
    status = models.CharField(
        max_length=20, choices=TaskStatus.choices, default=TaskStatus.PENDING
    )
    priority = models.SmallIntegerField(default=50)

    parent_task = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="children",
    )
    blocked_by = models.ManyToManyField(
        "self", symmetrical=False, related_name="blocks", blank=True
    )
    is_agent_discovered = models.BooleanField(default=False)
    discovered_during_task = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="discovered_tasks",
    )
    discovery_reason = models.TextField(blank=True, default="")
    suggested_priority = models.SmallIntegerField(null=True, blank=True)
    discovered_by_agent = models.CharField(max_length=120, blank=True, default="")

    assigned_agent_id = models.CharField(max_length=120, null=True, blank=True)
    lease_id = models.CharField(max_length=32, null=True, blank=True)
    lease_expires_at = models.DateTimeField(null=True, blank=True)
    last_heartbeat_at = models.DateTimeField(null=True, blank=True)

    claimed_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    review_summary = models.TextField(blank=True, default="")
    review_notes = models.TextField(blank=True, default="")
    attempt_count = models.SmallIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = TaskQuerySet.as_manager()

    class Meta:
        db_table = "core_task"
        ordering = ["-priority", "created_at"]
        indexes = [
            models.Index(
                fields=["project", "status", "-priority", "created_at"],
                name="task_claim_idx",
            ),
            models.Index(fields=["status", "lease_expires_at"], name="task_lease_idx"),
            models.Index(fields=["project", "status"], name="task_board_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(priority__gte=0) & models.Q(priority__lte=100),
                name="task_priority_range",
            ),
            models.CheckConstraint(
                check=(
                    models.Q(suggested_priority__isnull=True)
                    | (
                        models.Q(suggested_priority__gte=0)
                        & models.Q(suggested_priority__lte=100)
                    )
                ),
                name="task_suggested_priority_range",
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"Task({self.pk}, {self.status})"

    # -- derived (Doc 01 §6.9) --------------------------------------------
    @property
    def dod_progress_percent(self) -> int:
        items = list(self.checklist.all())
        if not items:
            return 0
        return round(sum(1 for i in items if i.completed) / len(items) * 100)

    def is_blocked(self) -> bool:
        return self.blocked_by.exclude(status=TaskStatus.COMPLETED).exists()
