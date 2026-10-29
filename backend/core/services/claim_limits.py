"""Claim-limit requests: the only way an agent can ask for a bigger ceiling.

`Project.claim_limit` belongs to the operator. An agent can observe that the
ceiling is too low for the work it can see, and it can explain why — but the
decision and the edit both stay human. This service records the ask, surfaces it
on the dashboard, and applies the approved value.
"""

from __future__ import annotations

from typing import Any

from django.db import transaction

from core.audit import audit
from core.enums import AuditEvent, ClaimLimitRequestStatus, EventType
from core.errors import ProjectNotFound, ValidationError
from core.events import emit
from core.ids import iso_z, utcnow
from core.models import ClaimLimitRequest, Project

#: Upper bound for a requested ceiling. High enough to never constrain real
#: work, low enough that a bad request cannot turn into an unbounded claim loop.
MAX_CLAIM_LIMIT = 50

#: `claim_limit == 0` means "no ceiling"; the operator can set it, an agent may not.
UNLIMITED = 0


def get_project(slug: str) -> Project:
    try:
        return Project.objects.get(slug=slug)
    except Project.DoesNotExist:
        raise ProjectNotFound(f"No project with slug '{slug}'.", detail={"slug": slug}) from None


def assert_claim_limit(value: Any) -> int:
    """Validate an operator-supplied ceiling; `0` is a deliberate "unlimited"."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError("claim_limit must be an integer.", detail={"field": "claim_limit"})
    if value < UNLIMITED or value > MAX_CLAIM_LIMIT:
        raise ValidationError(
            f"claim_limit must be between {UNLIMITED} and {MAX_CLAIM_LIMIT}.",
            detail={"field": "claim_limit", "min": UNLIMITED, "max": MAX_CLAIM_LIMIT},
        )
    return value


def to_dto(row: ClaimLimitRequest) -> dict:
    return {
        "id": str(row.pk),
        "project_slug": row.project.slug,
        "requested_by_agent": row.requested_by_agent,
        "current_limit": row.current_limit,
        "requested_limit": row.requested_limit,
        "reason": row.reason,
        "status": row.status,
        "resolved_by": row.resolved_by,
        "resolution_note": row.resolution_note,
        "resolved_at": iso_z(row.resolved_at),
        "created_at": iso_z(row.created_at),
        "updated_at": iso_z(row.updated_at),
    }


@transaction.atomic
def request_limit(
    *,
    project_slug: str,
    requested_limit: int,
    reason: str,
    agent_identifier: str,
) -> ClaimLimitRequest:
    """Record an agent's ask. Never mutates `Project.claim_limit`."""
    project = get_project(project_slug)
    if isinstance(requested_limit, bool) or not isinstance(requested_limit, int):
        raise ValidationError("requested_limit must be an integer.",
                              detail={"field": "requested_limit"})
    if requested_limit < 1 or requested_limit > MAX_CLAIM_LIMIT:
        raise ValidationError(
            f"requested_limit must be between 1 and {MAX_CLAIM_LIMIT}.",
            detail={"field": "requested_limit", "max": MAX_CLAIM_LIMIT},
        )
    if requested_limit <= project.claim_limit:
        raise ValidationError(
            f"requested_limit must exceed the current limit ({project.claim_limit}).",
            detail={"field": "requested_limit", "current_limit": project.claim_limit},
        )
    clean_reason = (reason or "").strip()
    if len(clean_reason) > 4000:
        raise ValidationError("reason exceeds 4000 characters.", detail={"field": "reason"})

    # Idempotent per (project, agent, target): re-asking for the same number
    # while it is still pending must not spam the operator's list.
    existing = ClaimLimitRequest.objects.filter(
        project=project,
        requested_by_agent=agent_identifier,
        requested_limit=requested_limit,
        status=ClaimLimitRequestStatus.PENDING,
    ).first()
    if existing is not None:
        if clean_reason and clean_reason != existing.reason:
            existing.reason = clean_reason
            existing.save(update_fields=["reason", "updated_at"])
        return existing

    row = ClaimLimitRequest.objects.create(
        project=project,
        requested_by_agent=agent_identifier,
        current_limit=project.claim_limit,
        requested_limit=requested_limit,
        reason=clean_reason,
    )
    audit(project=project, event=AuditEvent.CLAIM_LIMIT_REQUESTED,
          actor=agent_identifier,
          detail={"requested_limit": requested_limit, "current_limit": project.claim_limit})
    emit(project=project, type=EventType.CLAIM_LIMIT_REQUESTED, level="WARN",
         message=f"{agent_identifier} requests a claim limit of {requested_limit}",
         payload={"request_id": str(row.pk), "requested_limit": requested_limit,
                  "current_limit": project.claim_limit})
    return row


@transaction.atomic
def resolve_request(
    *,
    request_id,
    approve: bool,
    actor: str = "human",
    note: str = "",
    granted_limit: int | None = None,
) -> ClaimLimitRequest:
    """Approve (applying the ceiling) or dismiss a pending request."""
    try:
        row = ClaimLimitRequest.objects.select_related("project").get(pk=request_id)
    except (ClaimLimitRequest.DoesNotExist, ValueError, TypeError):
        raise ValidationError("Claim limit request not found.",
                              detail={"request_id": str(request_id)}) from None

    if row.status != ClaimLimitRequestStatus.PENDING:
        raise ValidationError(
            f"Request is already {row.status.lower()}.",
            detail={"field": "status", "status": row.status},
        )

    project = row.project
    now = utcnow()
    if approve:
        target = assert_claim_limit(
            granted_limit if granted_limit is not None else row.requested_limit
        )
        if target == UNLIMITED:
            raise ValidationError(
                "claim_limit 0 (unlimited) cannot be granted from an agent request.",
                detail={"field": "granted_limit"},
            )
        project.claim_limit = target
        project.save(update_fields=["claim_limit", "updated_at"])
        row.status = ClaimLimitRequestStatus.APPROVED
    else:
        row.status = ClaimLimitRequestStatus.DISMISSED

    row.resolved_by = actor
    row.resolution_note = (note or "").strip()
    row.resolved_at = now
    row.save(update_fields=["status", "resolved_by", "resolution_note", "resolved_at",
                            "updated_at"])

    audit(
        project=project,
        event=(AuditEvent.CLAIM_LIMIT_APPROVED if approve
               else AuditEvent.CLAIM_LIMIT_DISMISSED),
        actor=actor,
        detail={"request_id": str(row.pk), "claim_limit": project.claim_limit,
                "note": row.resolution_note},
    )
    emit(
        project=project,
        type=EventType.CLAIM_LIMIT_RESOLVED,
        message=(
            f"Claim limit request {row.status.lower()}"
            + (f" · limit is now {project.claim_limit}" if approve else "")
        ),
        payload={"request_id": str(row.pk), "status": row.status,
                 "claim_limit": project.claim_limit},
    )
    return row


def pending_requests(project: Project | None = None) -> list[ClaimLimitRequest]:
    qs = ClaimLimitRequest.objects.filter(status=ClaimLimitRequestStatus.PENDING)
    if project is not None:
        qs = qs.filter(project=project)
    return list(qs.select_related("project").order_by("-created_at"))
