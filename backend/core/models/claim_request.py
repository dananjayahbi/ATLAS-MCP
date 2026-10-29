"""`ClaimLimitRequest` — an agent asking the operator for a higher lease ceiling.

The project's `claim_limit` is the operator's knob and an agent must never be
able to raise it itself. This row is the only channel an agent has: the backend
records the ask, the HUD surfaces it, and only a human decision resolves it.
"""

from __future__ import annotations

import uuid

from django.db import models

from core.enums import ClaimLimitRequestStatus


class ClaimLimitRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "core.Project", on_delete=models.CASCADE, related_name="claim_limit_requests"
    )
    requested_by_agent = models.CharField(max_length=120)
    #: The ceiling the agent observed when it asked, for an audit-friendly diff.
    current_limit = models.PositiveSmallIntegerField()
    requested_limit = models.PositiveSmallIntegerField()
    reason = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=ClaimLimitRequestStatus.choices,
        default=ClaimLimitRequestStatus.PENDING,
    )
    resolved_by = models.CharField(max_length=120, blank=True, default="")
    resolution_note = models.TextField(blank=True, default="")
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "core_claimlimitrequest"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "status"], name="claimreq_project_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(requested_limit__gte=1),
                name="claimreq_limit_min",
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"ClaimLimitRequest({self.project_id}, {self.requested_limit})"
