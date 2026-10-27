"""`ChecklistItem` — Doc 01 §6.5."""

from __future__ import annotations

from django.db import models

from core.models.managers import ChecklistQuerySet


class ChecklistItem(models.Model):
    task = models.ForeignKey(
        "core.Task", on_delete=models.CASCADE, related_name="checklist"
    )
    order_index = models.SmallIntegerField()
    label = models.CharField(max_length=200)
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by_agent = models.CharField(max_length=120, null=True, blank=True)

    objects = ChecklistQuerySet.as_manager()

    class Meta:
        db_table = "core_checklistitem"
        ordering = ["task_id", "order_index"]
        constraints = [
            models.UniqueConstraint(
                fields=["task", "order_index"], name="checklist_unique_order"
            ),
            models.CheckConstraint(
                check=models.Q(order_index__gte=1), name="checklist_order_min"
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"ChecklistItem({self.task_id}#{self.order_index})"

    @property
    def wire_id(self) -> int:
        """MCP/REST expose `order_index` as the field `id` (Doc 01 §6.5)."""
        return self.order_index
