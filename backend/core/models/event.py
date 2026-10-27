"""`TaskEvent` — Doc 01 §6.7.

`seq` is monotonic **per project** and is the only ordering key used by SSE
`Last-Event-ID` replay (Doc 01 §11.3).
"""

from __future__ import annotations

from django.db import models

from core.enums import EventType, LogLevel


class TaskEvent(models.Model):
    id = models.CharField(max_length=32, primary_key=True)
    task = models.ForeignKey(
        "core.Task",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    project = models.ForeignKey(
        "core.Project", on_delete=models.CASCADE, related_name="events"
    )
    seq = models.BigIntegerField()
    type = models.CharField(max_length=32, choices=EventType.choices)
    level = models.CharField(max_length=8, choices=LogLevel.choices, default=LogLevel.INFO)
    message = models.TextField(blank=True, default="")
    payload = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_taskevent"
        ordering = ["project_id", "seq"]
        indexes = [
            models.Index(fields=["project", "seq"], name="event_project_seq_idx"),
            models.Index(fields=["task", "seq"], name="event_task_seq_idx"),
            models.Index(fields=["created_at"], name="event_created_idx"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["project", "seq"], name="event_seq_unique"),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"TaskEvent({self.id}, {self.type})"
